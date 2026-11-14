import { afterAll, describe, expect, it } from "vitest";
import { rollUpCost } from "@/lib/costing";
import { prisma } from "@/lib/db";
import { assessBooks } from "@/lib/read-models";
import { seedDemo } from "@/lib/seed-demo";
import { bankPosition, matchAllSuggestions, recordStatementLine } from "@/lib/services/money";
import { shipOrder } from "@/lib/services/sales";

describe("example books", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("seeds a balanced company and reconciles the bank", async () => {
    await seedDemo();
    const before = await assessBooks();
    expect(before.check.problems).toEqual([]);
    expect(before.check.ok).toBe(true);
    expect(before.arGl).toBe(before.arSub);
    expect(before.apGl).toBe(before.apSub);
    expect(before.inventoryGl).toBe(before.inventoryLots);

    const products = await prisma.product.findMany();
    const formulas = await prisma.formula.findMany({ include: { lines: true } });
    const preventer = products.find((product) => product.sku === "RUST-PREV");
    const rolled = rollUpCost(
      preventer!.id,
      products.map((product) => ({
        id: product.id,
        sku: product.sku,
        name: product.name,
        kind: product.kind,
        standardCost: Number(product.standardCost),
      })),
      formulas.map((formula) => ({
        productId: formula.productId,
        isDefault: formula.isDefault,
        lines: formula.lines.map((line) => ({ ingredientId: line.ingredientId, percent: Number(line.percent) })),
      })),
    );
    expect(rolled.status).toBe("OK");
    expect(rolled.costPerUnit).toBeCloseTo(0.4018, 4);

    const waiting = await prisma.lot.findFirst({ where: { qcStatus: "QUARANTINE" }, include: { product: true } });
    expect(waiting?.product.sku).toBe("RUST-PREV");
    const quote = await prisma.quote.findFirst({ where: { status: "DRAFT" } });
    expect(quote).toBeTruthy();

    const bank = await bankPosition();
    expect(bank.explained.agreesNow).toBe(false);
    expect(bank.explained.explained).toBe(true);
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: "frank@sper.example" } });
    const actor = { id: owner.id, name: owner.name, role: "OWNER" as const };
    const matched = await matchAllSuggestions(actor);
    expect(matched.ok).toBe(true);
    const fee = (await bankPosition()).statement.find((line) => line.amountCents === -1500 && !line.reconciled);
    expect(fee).toBeTruthy();
    const recorded = await recordStatementLine(actor, fee!.id);
    expect(recorded.ok).toBe(true);
    const afterBank = await bankPosition();
    expect(afterBank.explained.agreesNow).toBe(true);
    const after = await assessBooks();
    expect(after.check.ok).toBe(true);

    const order = await prisma.salesOrder.create({
      data: {
        number: "SO-TEST",
        partyId: (await prisma.party.findUniqueOrThrow({ where: { code: "CITY-CW" } })).id,
        orderedOn: new Date("2026-11-14T12:00:00Z"),
        lines: {
          create: {
            productId: waiting!.productId,
            description: "Should not ship",
            qty: 1,
            unitPriceCents: 425,
            sort: 0,
          },
        },
      },
    });
    const line = await prisma.salesOrderLine.findFirstOrThrow({ where: { orderId: order.id } });
    const shipped = await shipOrder(actor, {
      orderId: order.id,
      quantities: [{ orderLineId: line.id, qty: 1 }],
      shippedOn: new Date("2026-11-14T12:00:00Z"),
      carrier: "",
      tracking: "",
      notes: "",
    });
    expect(shipped.ok).toBe(false);
  });
});
