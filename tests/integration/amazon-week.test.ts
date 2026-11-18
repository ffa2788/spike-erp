import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { assessBooks } from "@/lib/read-models";
import { seedDemo } from "@/lib/seed-demo";
import { loadAmazonReconciliation } from "@/lib/services/amazon-report-import";
import { importAllOrdersFile } from "@/lib/services/amazon-import";
import { importPaymentsFile } from "@/lib/services/amazon-payments-import";
import { postJournal, run } from "@/lib/services/shared";
import { CODES } from "@/lib/chart";

const orders = readFileSync("tests/fixtures/amazon-all-orders.tsv", "utf8");
const payments = readFileSync("tests/fixtures/amazon-payments.csv", "utf8");

describe("a sample Amazon week posts from the reports", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates A- invoices, refunds, fees, and a deposit, and lists the unmapped SKU", async () => {
    await seedDemo();
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: "frank@sper.example" } });
    const actor = { id: owner.id, name: owner.name, role: "OWNER" as const };
    await placeExampleStock(actor, "RUST-1G", "AMAZON", 10);
    await placeExampleStock(actor, "RUST-REM", "MAIN", 10);
    const posted = await importAllOrdersFile(actor, orders);
    expect(posted.ok).toBe(true);
    if (!posted.ok) return;
    expect(posted.value.invoices.length).toBeGreaterThan(0);
    expect(posted.value.invoices.every((number) => number.startsWith("A-"))).toBe(true);
    expect(posted.value.unmapped.some((row) => row.sku.includes("missing"))).toBe(true);
    const again = await importAllOrdersFile(actor, orders);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.invoices).toEqual([]);

    const money = await importPaymentsFile(actor, payments);
    expect(money.ok).toBe(true);
    if (!money.ok) return;
    expect(money.value.refunds).toBeGreaterThan(0);
    expect(money.value.feeCents).toBeGreaterThan(0);
    expect(money.value.transferCents).toBe(123456);
    const label = await prisma.journalLine.findFirst({ where: { account: { code: "6150" }, memo: { contains: "111-0000002-0000002" } } });
    expect(label?.debitCents).toBe(450);
    expect(money.value.settled.length).toBeGreaterThan(0);
    const repeat = await importPaymentsFile(actor, payments);
    expect(repeat.ok).toBe(true);
    if (!repeat.ok) return;
    expect(repeat.value.created).toBe(0);
    expect(repeat.value.transferCents).toBe(0);

    const books = await assessBooks();
    expect(books.check.ok).toBe(true);
    const check = await loadAmazonReconciliation("2026-11");
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.value.differences.some((row) => row.kind === "unmapped SKU")).toBe(true);
    expect(check.value.depositCents).toBe(123456);
    expect(check.value.refundCount).toBeGreaterThan(0);
  });
});

async function placeExampleStock(actor: { id: string; name: string; role: "OWNER" }, sku: string, locationCode: string, qty: number) {
  const product = await prisma.product.findUniqueOrThrow({ where: { sku } });
  const location = await prisma.location.findUniqueOrThrow({ where: { code: locationCode } });
  const on = new Date("2026-10-01T12:00:00Z");
  const placed = await run(async (tx) => {
    const lot = await tx.lot.create({
      data: { lotNumber: `EX-${sku}-${locationCode}`, productId: product.id, qcStatus: "APPROVED", unitCost: 5, receivedOn: on, origin: "MAKE", isExample: true },
    });
    await tx.movement.create({
      data: { at: on, lotId: lot.id, productId: product.id, locationId: location.id, qty, reason: "OPENING", refType: "Lot", refId: lot.id },
    });
    return postJournal(tx, actor, {
      date: on,
      memo: `Example stock for ${sku}`,
      source: "OPENING",
      lines: [
        { accountCode: CODES.invFg, debitCents: qty * 500, creditCents: 0, memo: sku },
        { accountCode: CODES.equity, debitCents: 0, creditCents: qty * 500, memo: sku },
      ],
      isExample: true,
    });
  });
  if (!placed.ok) throw new Error(placed.error);
}
