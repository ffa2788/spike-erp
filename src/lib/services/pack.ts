import { inventoryAccount } from "../chart";
import { fefoAllocate, lotQty, reliefCents, roundQty } from "../inventory";
import { packJournal } from "../journals";
import { qtyPerUnit, type PackBasisName } from "../formula-math";
import { err, ok, type Result } from "../result";
import { audit, deny, loadBalances, locationByCode, nextNumber, postJournal, run, type Actor, type Tx } from "./shared";
import { toDateInput } from "../dates";

export async function packGoods(
  actor: Actor,
  input: { packagedSkuId: string; units: number; packedOn: Date },
): Promise<Result<{ runId: string }>> {
  const denied = deny(actor, "produce");
  if (denied) return denied;
  if (!Number.isInteger(input.units) || input.units <= 0) return err("Enter how many packages to make.");
  return run((tx) => packTx(tx, actor, input));
}

async function packTx(
  tx: Tx,
  actor: Actor,
  input: { packagedSkuId: string; units: number; packedOn: Date },
): Promise<Result<{ runId: string }>> {
  const sku = await tx.packagedSku.findUnique({
    where: { id: input.packagedSkuId },
    include: {
      product: true,
      outputProduct: true,
      lines: { include: { material: true } },
    },
  });
  if (!sku) return err("That package was not found.");
  const formula = await tx.formula.findFirst({ where: { productId: sku.productId, isDefault: true } });
  const gravity = formula?.specificGravity != null ? Number(formula.specificGravity) : sku.product.specificGravity != null ? Number(sku.product.specificGravity) : null;
  const preset = (await import("../formula-math")).PACKAGE_PRESETS.find((item) => item.code === sku.packageCode);
  if (!preset) return err("That package size is not one SPER sells.");
  const contentsLb = (await import("../formula-math")).contentsWeightLb({
    form: preset.form,
    gallons: preset.gallons,
    netLb: preset.netLb,
    specificGravity: gravity,
  });
  if (contentsLb == null) return err("Set the specific gravity before packing a liquid.");
  const asOf = toDateInput(input.packedOn);
  const mutable = (await loadBalances(tx)).map((lot) => ({ ...lot, locations: lot.locations.map((location) => ({ ...location })) }));
  const consume: { productId: string; lotId: string; locationId: string; qty: number; cents: number; account: string }[] = [];

  const take = (productId: string, qty: number, account: string) => {
    const allocation = fefoAllocate(mutable, productId, qty, asOf);
    if (!allocation.ok) return allocation.error;
    for (const pick of allocation.picks) {
      const lot = mutable.find((item) => item.lotId === pick.lotId);
      const place = lot?.locations.find((item) => item.locationId === pick.locationId);
      if (!lot || !place) return "A lot changed while packing.";
      const before = lotQty(lot);
      place.qty = roundQty(place.qty - pick.qty);
      consume.push({
        productId,
        lotId: pick.lotId,
        locationId: pick.locationId,
        qty: pick.qty,
        cents: reliefCents(before, lotQty(lot), lot.unitCost),
        account,
      });
    }
    return null;
  };

  const bulkAccount = inventoryAccount(sku.product.kind);
  if (!bulkAccount) return err("The bulk product is not stored in inventory.");
  const bulkError = take(sku.productId, roundQty(contentsLb * input.units), bulkAccount);
  if (bulkError) return err(`${sku.product.name}: ${bulkError}`);

  for (const line of sku.lines) {
    const each = qtyPerUnit({
      basis: line.basis as PackBasisName,
      qty: Number(line.qty),
      unitsPerCase: sku.unitsPerCase,
      casesPerPallet: sku.casesPerPallet,
    });
    if (each == null) return err(`${line.material.name} could not be split per package.`);
    const account = inventoryAccount(line.material.kind);
    if (!account) return err(`${line.material.name} is not stored in inventory.`);
    const problem = take(line.materialId, roundQty(each * input.units), account);
    if (problem) return err(`${line.material.name}: ${problem}`);
  }

  const bulkCents = consume.filter((row) => row.productId === sku.productId).reduce((sum, row) => sum + row.cents, 0);
  const packagingCents = consume.filter((row) => row.productId !== sku.productId).reduce((sum, row) => sum + row.cents, 0);
  const laborCents = Math.round(Number(sku.laborPerUnit) * input.units * 100);
  const outputCents = bulkCents + packagingCents + laborCents;
  const run = await tx.packRun.create({
    data: {
      number: await nextNumber(tx, "pack"),
      packagedSkuId: sku.id,
      units: input.units,
      packedOn: input.packedOn,
      contentsCostCents: bulkCents,
      packagingCostCents: packagingCents,
      laborCents,
      isExample: sku.isExample,
    },
  });
  for (const row of consume) {
    await tx.movement.create({
      data: {
        lotId: row.lotId,
        productId: row.productId,
        locationId: row.locationId,
        qty: -row.qty,
        reason: "PACK",
        refType: "PackRun",
        refId: run.id,
      },
    });
  }
  const main = await locationByCode(tx, "MAIN");
  const unitCost = outputCents / 100 / input.units;
  const lot = await tx.lot.create({
    data: {
      lotNumber: await nextNumber(tx, "lot"),
      productId: sku.outputProductId,
      qcStatus: "APPROVED",
      unitCost,
      manufacturedOn: input.packedOn,
      origin: "PACK",
      nsfEligible: Boolean(sku.outputProduct.nsfListingId),
      formulaVersion: sku.outputProduct.nsfFormulaVersion,
      releasedOn: input.packedOn,
      releasedBy: actor.name,
      notes: `Packed on ${run.number}`,
      isExample: sku.isExample,
    },
  });
  await tx.movement.create({
    data: {
      lotId: lot.id,
      productId: sku.outputProductId,
      locationId: main.id,
      qty: input.units,
      reason: "PACK",
      refType: "PackRun",
      refId: run.id,
    },
  });
  const journal = await postJournal(tx, actor, {
    date: input.packedOn,
    memo: `Packed ${run.number}`,
    source: "PACK",
    sourceId: run.id,
    lines: packJournal({ outputCents, bulkCents, packagingCents, laborCents }),
    isExample: sku.isExample,
  });
  if (!journal.ok) return journal;
  await tx.packRun.update({ where: { id: run.id }, data: { journalId: journal.value, outputLotId: lot.id } });
  await audit(tx, actor, "pack", "PackRun", run.id, `Packed ${input.units} of ${sku.outputProduct.sku}.`);
  return ok({ runId: run.id });
}
