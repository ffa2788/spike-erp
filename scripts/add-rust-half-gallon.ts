import "dotenv/config";
import { nameKey, validCode } from "../src/lib/names";
import { prisma } from "../src/lib/db";
import { halfGallonPackPlan } from "../src/lib/rust-preventer-packs";

async function main() {
  const apply = process.argv.includes("--apply");
  const plan = halfGallonPackPlan();
  if (!plan.ok) {
    throw new Error(`Not saved. Fill in ${plan.missing.join(", ")} in src/lib/rust-preventer-packs.ts.`);
  }
  for (const sku of [plan.jugSku, ...plan.packs.map((pack) => pack.sku)]) {
    if (!validCode(sku.toUpperCase())) throw new Error(`SKU ${sku} should use letters, numbers, and hyphens.`);
  }
  const bulk = await prisma.product.findUnique({ where: { sku: plan.bulkSku } });
  if (!bulk) throw new Error(`${plan.bulkSku} is not on file, so the 0.5 gal packs were not added.`);
  console.log(apply ? "Applying." : "Dry run. Nothing will be written.");
  console.log(`Jug ${plan.jugSku} at $${plan.jugCostDollars.toFixed(2)} each.`);
  for (const pack of plan.packs) {
    console.log(`${pack.sku}: ${pack.jugs} x 0.5 gal of ${plan.bulkSku}, jug ${plan.jugSku}.`);
  }
  if (!apply) {
    console.log("Run again with --apply to write.");
    return;
  }
  const jug = await prisma.product.upsert({
    where: { sku: plan.jugSku },
    update: { standardCost: plan.jugCostDollars },
    create: {
      sku: plan.jugSku,
      name: "0.5 gal jug",
      nameKey: nameKey("0.5 gal jug"),
      kind: "PACKAGING",
      unit: "each",
      standardCost: plan.jugCostDollars,
      sellable: false,
      trackInventory: true,
      notes: "Empty jug for Rust Preventer 0.5 gal packs.",
    },
  });
  for (const pack of plan.packs) {
    const output = await prisma.product.upsert({
      where: { sku: pack.sku },
      update: {},
      create: {
        sku: pack.sku,
        name: pack.name,
        nameKey: nameKey(pack.name),
        kind: "FINISHED",
        form: "LIQUID",
        unit: "each",
        standardCost: 0,
        priceStatus: "UNSET",
        sellable: true,
        trackInventory: true,
        notes: `Presentation of ${plan.bulkSku}. ${pack.jugs} jugs of 0.5 gal. Jug cost is on ${plan.jugSku}.`,
      },
    });
    const existing = await prisma.packagedSku.findUnique({ where: { outputProductId: output.id } });
    if (existing) continue;
    await prisma.packagedSku.create({
      data: {
        productId: bulk.id,
        outputProductId: output.id,
        packageCode: pack.packageCode,
        unitsPerCase: 1,
        casesPerPallet: 0,
        lines: { create: [{ materialId: jug.id, basis: "UNIT", qty: pack.jugs }] },
      },
    });
  }
  console.log("Added the 0.5 gal presentations. Cases per pallet are 0 until that number is known, so a full packaged cost is not shown.");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
