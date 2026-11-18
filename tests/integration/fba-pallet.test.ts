import { afterAll, describe, expect, it } from "vitest";
import { CODES } from "@/lib/chart";
import { prisma } from "@/lib/db";
import { assessBooks } from "@/lib/read-models";
import { seedDemo } from "@/lib/seed-demo";
import {
  fbaDate,
  fbaMargin,
  postFbaStorageFee,
  receiveFbaShipment,
  reimburseFbaLoss,
  returnToFba,
  sellFromFba,
  settleFbaDeposit,
  shipToFba,
  trueUpFba,
} from "@/lib/services/fba-ledger";
import { postJournal, run } from "@/lib/services/shared";
import { ok } from "@/lib/result";

describe("FBA pallet of 300", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("ships at cost, sells 50, takes 2 back, reimburses 1 lost, and the deposit clears Amazon", async () => {
    await seedDemo();
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: "frank@sper.example" } });
    const actor = { id: owner.id, name: owner.name, role: "OWNER" as const };
    const product = await prisma.product.findFirstOrThrow({ where: { sku: "RUST-1G" } });
    const main = await prisma.location.findUniqueOrThrow({ where: { code: "MAIN" } });
    const opened = await run(async (tx) => {
      const lot = await tx.lot.create({
        data: {
          lotNumber: "PALLET-300",
          productId: product.id,
          qcStatus: "APPROVED",
          unitCost: 5,
          receivedOn: fbaDate("2026-11-01"),
          origin: "MAKE",
          isExample: true,
        },
      });
      await tx.movement.create({
        data: {
          at: fbaDate("2026-11-01"),
          lotId: lot.id,
          productId: product.id,
          locationId: main.id,
          qty: 300,
          reason: "OPENING",
          refType: "Lot",
          refId: lot.id,
        },
      });
      const journal = await postJournal(tx, actor, {
        date: fbaDate("2026-11-01"),
        memo: "Pallet of 300 for FBA",
        source: "OPENING",
        lines: [
          { accountCode: CODES.invFg, debitCents: 150_000, creditCents: 0, memo: "300 units at $5" },
          { accountCode: CODES.equity, debitCents: 0, creditCents: 150_000, memo: "300 units at $5" },
        ],
        isExample: true,
      });
      if (!journal.ok) return journal;
      return ok(lot.id);
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const shipped = await shipToFba(actor, {
      shipmentId: "FBA-PALLET-300",
      shippedOn: fbaDate("2026-11-02"),
      freightCents: 30_000,
      spreadBy: "UNITS",
      lines: [{ lotId: opened.value, qty: 300, weightLb: 3000 }],
    });
    expect(shipped.ok).toBe(true);
    if (!shipped.ok) throw new Error(shipped.error);

    const received = await receiveFbaShipment(actor, {
      shipmentId: "FBA-PALLET-300",
      receivedOn: fbaDate("2026-11-05"),
      lines: [{ productId: product.id, qtyReceived: 300 }],
    });
    expect(received.ok).toBe(true);
    if (!received.ok) throw new Error(received.error);
    expect(received.value.claims).toEqual([]);

    const fbaLot = await prisma.lot.findFirstOrThrow({ where: { lotNumber: { startsWith: "PALLET-300-FBA" } } });
    expect(Number(fbaLot.unitCost)).toBeCloseTo(6, 4);

    const sale = await sellFromFba(actor, {
      orderId: "111-PALLET-50",
      productId: product.id,
      qty: 50,
      unitPriceCents: 2_000,
      feeCents: 15_000,
      soldOn: fbaDate("2026-11-10"),
    });
    expect(sale.ok).toBe(true);
    if (!sale.ok) throw new Error(sale.error);
    expect(sale.value.number.startsWith("A-")).toBe(true);
    expect(sale.value.cogsCents).toBe(30_000);

    const returned = await returnToFba(actor, {
      productId: product.id,
      qty: 2,
      sellable: true,
      unitPriceCents: 2_000,
      returnedOn: fbaDate("2026-11-12"),
    });
    expect(returned.ok).toBe(true);

    const lost = await reimburseFbaLoss(actor, {
      productId: product.id,
      qty: 1,
      reimbursementCents: 600,
      lostOn: fbaDate("2026-11-13"),
    });
    expect(lost.ok).toBe(true);
    if (!lost.ok) throw new Error(lost.error);
    expect(lost.value.costCents).toBe(600);

    const storage = await postFbaStorageFee(actor, { cents: 1_000, on: fbaDate("2026-11-14"), sku: product.sku });
    expect(storage.ok).toBe(true);

    const deposit = await settleFbaDeposit(actor, { cents: 80_600, on: fbaDate("2026-11-16"), reference: "SYNTH-PALLET" });
    expect(deposit.ok).toBe(true);

    const amazon = await prisma.location.findUniqueOrThrow({ where: { code: "AMAZON" } });
    const moves = await prisma.movement.findMany({ where: { locationId: amazon.id, productId: product.id } });
    const onHand = moves.reduce((sum, move) => sum + Number(move.qty), 0);
    expect(onHand).toBeCloseTo(251, 4);

    const margin = await fbaMargin(product.id);
    expect(margin.netSalesCents).toBe(96_000);
    expect(margin.cogsCents).toBe(28_800);
    expect(margin.feeCents).toBe(15_000);
    expect(margin.marginCents).toBe(52_200);

    const matched = await trueUpFba(actor, { on: fbaDate("2026-11-30"), rows: [{ productId: product.id, reportQty: 251 }] });
    expect(matched.ok).toBe(true);
    if (!matched.ok) throw new Error(matched.error);
    expect(matched.value.variances[0]).toMatchObject({ spikeQty: 251, reportQty: 251, delta: 0 });

    const books = await assessBooks();
    expect(books.check.ok).toBe(true);

    const lines = await prisma.journalLine.findMany({
      where: { entry: { source: { startsWith: "FBA_" } } },
      include: { account: true, entry: true },
    });
    const net = (code: string) => lines.filter((line) => line.account.code === code).reduce((sum, line) => sum + line.debitCents - line.creditCents, 0);
    expect(net(CODES.amazonClearing)).toBe(0);
    expect(net(CODES.sales)).toBe(-96_000);
    expect(net(CODES.cogs)).toBe(28_800 + 600);
    expect(net(CODES.amazonFees)).toBe(16_000);
    expect(net(CODES.otherIncome)).toBe(-600);
    expect(net(CODES.cash)).toBe(80_600 - 30_000);
    expect(net(CODES.invFg)).toBe(30_000 - 30_000 + 1_200 - 600);
  });
});
