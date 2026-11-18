import { afterAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { assessBooks } from "@/lib/read-models";
import { wipeDatabase } from "@/lib/seed-demo";
import { commitGolive } from "@/lib/services/golive-import";
import { ensureFoundation } from "@/lib/services/money";
import { commitPeachtree } from "@/lib/services/importers";
import { importAllOrdersFile } from "@/lib/services/amazon-import";
import { acceptQuote, invoiceDelivery, payInvoice, saveQuote, shipOrder } from "@/lib/services/sales";

const actor = { id: "", name: "FFA", role: "OWNER" as const };
const day = new Date("2026-11-01T12:00:00Z");

function must<T>(result: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!result.ok) throw new Error(`${label}: ${result.error}`);
  return result.value;
}

describe("cutover from Peachtree", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("loads a starting point once, then sells, ships, and imports Amazon without double posting", async () => {
    await wipeDatabase();
    const user = await prisma.user.create({
      data: { email: "owner@sper.example", name: "FFA", role: "OWNER", passwordHash: await bcrypt.hash("12345678", 4), totpEnabled: false },
    });
    const who = { ...actor, id: user.id };
    must(await ensureFoundation(who, { example: false }), "foundation");
    must(await commitPeachtree(who, "Customer ID,Customer Name\nCUT-1,Cutover Customer\n", "customers"), "customers");
    must(await commitPeachtree(who, "Vendor ID,Vendor Name\nSUP-1,Cutover Vendor\nAMZ,Amazon\n", "vendors"), "vendors");
    await prisma.party.update({ where: { code: "AMZ" }, data: { isCustomer: true, channel: "AMAZON" } });
    must(await commitPeachtree(who, [
      "Item ID,Item Description,Sales Price,Cost,Kind",
      "RAW-1,Raw material,,2.00,RAW",
      "FIN-1,Finished jug,10.00,5.00,FINISHED",
    ].join("\n"), "items"), "items");
    const fin = await prisma.product.findUniqueOrThrow({ where: { sku: "FIN-1" } });
    await prisma.amazonSkuMap.create({ data: { amazonSku: "FIN-1", asin: "B000TEST", productId: fin.id } });
    must(await commitGolive(who, "Finished SKU,Ingredient SKU,Percent\nFIN-1,RAW-1,100\n", "formula"), "formula");
    must(await commitGolive(who, "Item ID,Quantity,Unit Cost,Lot Number\nRAW-1,10,2.00,OPEN-RAW-1\nFIN-1,2,5.00,OPEN-FIN-1\n", "stock"), "stock");
    must(await commitGolive(who, "Customer ID,Invoice Number,Date,Amount\nCUT-1,PT-1001,11/01/2026,100.00\n", "ar"), "ar");
    must(await commitGolive(who, "Vendor ID,Bill Number,Date,Amount\nSUP-1,V-55,11/01/2026,50.00\n", "ap"), "ap");
    must(await commitGolive(who, [
      "Account ID,Debit,Credit",
      "1000,1000.00,",
      "1100,100.00,",
      "1200,20.00,",
      "1210,10.00,",
      "2000,,50.00",
      "3900,,1080.00",
    ].join("\n"), "trial"), "trial");
    const again = must(await commitGolive(who, "Item ID,Quantity,Unit Cost,Lot Number\nRAW-1,10,2.00,OPEN-RAW-1\n", "stock"), "stock again");
    expect(again.saved).toBe(0);
    const trialAgain = must(await commitGolive(who, "Account ID,Debit,Credit\n1000,1.00,\n3900,,1.00\n", "trial"), "trial again");
    expect(trialAgain.saved).toBe(0);
    const opened = await assessBooks();
    expect(opened.check.problems).toEqual([]);

    const customer = await prisma.party.findUniqueOrThrow({ where: { code: "CUT-1" } });
    const quote = must(await saveQuote(who, {
      partyId: customer.id,
      issuedOn: day,
      validUntil: day,
      notes: "Cutover sale",
      terms: { namedPlace: "Clearwater plant" },
      lines: [{ productId: fin.id, qty: 1, specialPrice: null }],
    }), "quote");
    const accepted = must(await acceptQuote(who, quote.id), "accept");
    const shipped = must(await shipOrder(who, { orderId: accepted.orderId, shipAll: true, shippedOn: day, carrier: "Truck", tracking: "", notes: "" }), "ship");
    const invoiced = must(await invoiceDelivery(who, shipped.deliveryId, day), "invoice");
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiced.invoiceId } });
    expect(invoice.number.startsWith("S-")).toBe(true);
    must(await payInvoice(who, { invoiceId: invoice.id, amountCents: invoice.balanceCents, paidOn: day, method: "Check", reference: "1001" }), "pay");

    const orders = [
      "amazon-order-id\torder-item-id\tpurchase-date\tlast-updated-date\torder-status\tfulfillment-channel\tsku\tquantity\titem-price\titem-promotion-discount",
      "111-GOLIVE-1\t1\t2026-11-02T12:00:00+00:00\t2026-11-02T12:00:00+00:00\tShipped\tMerchant\tFIN-1\t1\t10.00\t0",
    ].join("\n");
    const first = must(await importAllOrdersFile(who, orders), "amazon");
    expect(first.invoices).toHaveLength(1);
    expect(first.invoices[0].startsWith("A-")).toBe(true);
    const second = must(await importAllOrdersFile(who, orders), "amazon again");
    expect(second.invoices).toEqual([]);
    const after = await assessBooks();
    expect(after.check.problems).toEqual([]);
    expect(after.arGl).toBe(after.arSub);
    expect(after.apGl).toBe(after.apSub);
    expect(after.inventoryGl).toBe(after.inventoryLots);
  });
});
