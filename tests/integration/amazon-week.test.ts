import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { assessBooks } from "@/lib/read-models";
import { seedDemo } from "@/lib/seed-demo";
import { loadAmazonReconciliation } from "@/lib/services/amazon-report-import";
import { importAllOrdersFile } from "@/lib/services/amazon-import";
import { importPaymentsFile } from "@/lib/services/amazon-payments-import";

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
