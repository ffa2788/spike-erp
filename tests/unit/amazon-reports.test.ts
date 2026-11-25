import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_ORDERS_HEADERS, dedupeOrders, fbaZeroProblem, parseAllOrders, parseFbaManageInventory, planSkuMaps, suggestAmazonSku } from "@/lib/amazon-reports";
import { orderStockHolds } from "@/lib/amazon-stock";
import { planAmazonCustomer } from "@/lib/amazon-customer";
import { paymentImportTotals, type PaymentRow } from "@/lib/amazon-payments";

const orders = readFileSync("tests/fixtures/amazon-all-orders.tsv", "utf8");
const fba = `\uFEFF${readFileSync("tests/fixtures/amazon-fba-inventory.tsv", "utf8")}`;

describe("Amazon Seller Central files", () => {
  it("uses the All Orders headers, ignores a trailing header space, and never keeps buyer ids", () => {
    for (const header of ALL_ORDERS_HEADERS) expect(orders).toContain(header);
    const rows = parseAllOrders(orders.replace("amazon-order-id", "amazon-order-id "));
    expect(JSON.stringify(rows)).not.toContain("SYNTHETIC-DO-NOT-KEEP");
    const kept = dedupeOrders(rows);
    const item = kept.find((row) => row.orderItemId === "1001");
    expect(item?.netCents).toBe(3200);
    expect(item?.lastUpdated).toBe("2026-11-02T16:00:00+00:00");
    expect(item?.shipCity).toBe("Tampa");
    expect(item?.shipState).toBe("FL");
    expect(item?.shipPostalCode).toBe("33602");
    expect(kept.find((row) => row.orderItemId === "1002")?.cancelled).toBe(true);
    expect(kept.find((row) => row.orderItemId === "1002")?.shipped).toBe(false);
    expect(kept.find((row) => row.orderItemId === "2001")?.fulfillment).toBe("FBM");
    expect(kept.find((row) => row.sku === "SC-RP1-1.0-1")?.fulfillment).toBe("FBA");
    expect(kept.some((row) => row.sku === "SC-RP1-1.0-1 -FBA")).toBe(true);
  });

  it("reads FBA fulfillable and inbound by header name, including a byte-order mark", () => {
    const rows = parseFbaManageInventory(fba);
    expect(rows[0]).toMatchObject({ sku: "SC-RP1-1.0-1", fulfillable: 6, inbound: 4, reserved: 1, shipped30: 3, daysOfSupply: 20 });
    expect(rows.find((row) => row.sku === "SC-RP1-1.0-1 -FBA")?.fulfillable).toBe(2);
  });

  it("auto-maps only an exact SKU and treats every Shipped status as shipped", () => {
    const products = [
      { id: "gal", sku: "RUST-PREVENTER-1", name: "Rust Preventer LC 1 gal" },
      { id: "rem", sku: "IRON-STAIN-5", name: "Iron stain remover 5 gallon" },
    ];
    expect(suggestAmazonSku({ sku: " rust-preventer-1 ", asin: "B0BZLYZQ2P", products }).productId).toBe("gal");
    expect(suggestAmazonSku({ sku: "1 gal preventer", asin: "B0BZLYZQ2P", products }).productId).toBeNull();
    expect(suggestAmazonSku({ sku: "Rust Remover", asin: "B0CTQ5MFNQ", products }).productId).toBeNull();
    expect(suggestAmazonSku({ sku: "SC-RP1-1.0-1 -FBA", asin: "B0BZLYZQ2P", products }).productId).toBeNull();
    const text = [
      "amazon-order-id\torder-item-id\torder-status\titem-status\tsku\tquantity\titem-price",
      "1\t1\tShipped\tShipped\tA\t1\t10",
      "2\t2\tShipped - Delivered to Buyer\tShipped\tA\t1\t10",
      "3\t3\tShipped - Picked Up\tShipped\tA\t1\t10",
      "4\t4\tShipped - Out for Delivery\tShipped\tA\t1\t10",
      "5\t5\tPending\tUnshipped\tA\t1\t10",
      "6\t6\tCancelled\tShipped\tA\t1\t10",
    ].join("\n");
    const rows = parseAllOrders(text);
    expect(rows.filter((row) => row.shipped)).toHaveLength(4);
    expect(rows.find((row) => row.orderItemId === "5")?.shipped).toBe(false);
    expect(rows.find((row) => row.orderItemId === "6")?.cancelled).toBe(true);
    expect(rows.find((row) => row.orderItemId === "6")?.shipped).toBe(false);
  });

  it("reads the Manage FBA Inventory export and refuses a file whose quantities come back as zero", () => {
    const header = "sku,fnsku,asin,product-name,condition,your-price,mfn-listing-exists,mfn-fulfillable-quantity,afn-listing-exists,afn-warehouse-quantity,afn-fulfillable-quantity,afn-unsellable-quantity,afn-reserved-quantity,afn-total-quantity,per-unit-volume,afn-inbound-working-quantity,afn-inbound-shipped-quantity,afn-inbound-receiving-quantity,afn-researching-quantity,afn-reserved-future-supply,afn-future-supply-buyable,afn-fc-transfer-quantity,afn-onhand-buyable-quantity,store";
    const csv = [
      header,
      'SC-HDBD-01-1,X1,B000001,"Heavy duty\uFFFDbinder",New,10,No,0,Yes,106,104,2,0,106,0.1,0,0,0,0,0,0,0,104,Main',
      '"SC-RP1-1.0-1 -FBA",X2,B000002,"Rust preventer, 1 gal",New,20,No,0,Yes,185,87,0,13,185,0.2,1,2,3,0,0,0,0,87,Main',
    ].join("\n");
    const rows = parseFbaManageInventory(csv);
    expect(rows.find((row) => row.sku === "SC-HDBD-01-1")).toMatchObject({ fulfillable: 104, unfulfillable: 2, inboundQuantity: 106, reserved: 0 });
    expect(rows.find((row) => row.sku === "SC-RP1-1.0-1 -FBA")).toMatchObject({ fulfillable: 87, reserved: 13, inbound: 6, inboundQuantity: 185 });
    expect(fbaZeroProblem(104, 0)).toMatch(/read zero/);
    expect(fbaZeroProblem(0, 0)).toBeNull();
  });

  it("plans one Amazon customer and rejects an unknown product on a SKU map", () => {
    const parties = [
      { id: "a", code: "AMAZON-SALES", name: "Amazon sales", channel: "DIRECT", isCustomer: true },
      { id: "b", code: "AMAZON-FULFILLMENT", name: "Amazon Fulfillment", channel: "DIRECT", isCustomer: true },
    ];
    expect(planAmazonCustomer("AMAZON-SALES", parties).ok).toBe(true);
    const taken = planAmazonCustomer("AMAZON-FULFILLMENT", parties.map((row) => row.id === "a" ? { ...row, channel: "AMAZON" } : row));
    expect(taken.ok).toBe(false);
    const again = planAmazonCustomer("AMAZON-SALES", parties.map((row) => row.id === "a" ? { ...row, channel: "AMAZON" } : row));
    expect(again.ok && again.already).toBe(true);
    const mapped = planSkuMaps({
      mappings: [{ amazonSku: "SC-HDBD-01-1", productId: "missing" }],
      products: [{ id: "gal", sku: "RUST-PREVENTER-1" }],
      existing: [],
    });
    expect(mapped.ok).toBe(false);
    const ready = planSkuMaps({
      mappings: [{ amazonSku: "RUST-PREVENTER-1", productId: "gal" }],
      products: [{ id: "gal", sku: "RUST-PREVENTER-1" }],
      existing: [],
    });
    expect(ready.ok && ready.changes[0].action).toBe("create");
    expect(ready.ok && ready.changes[0].units).toBe(1);
    const four = planSkuMaps({
      mappings: [{ amazonSku: "SC-PR1-1-4PK", productId: "gal", units: 4 }],
      products: [{ id: "gal", sku: "RUST-PREVENTER-1" }],
      existing: [],
    });
    expect(four.ok && four.changes[0]).toMatchObject({ units: 4, action: "create", productSku: "RUST-PREVENTER-1" });
    expect(planSkuMaps({
      mappings: [{ amazonSku: "SC-PR1-1-4PK", productId: "gal", units: 0 }],
      products: [{ id: "gal", sku: "RUST-PREVENTER-1" }],
      existing: [],
    }).ok).toBe(false);
  });

  it("holds an order when released stock is short and leaves that stock in place", () => {
    const lots = [{
      lotId: "lot", lotNumber: "A", productId: "gal", qcStatus: "APPROVED" as const, expiresOn: null, receivedOn: "2026-10-01",
      unitCost: 1, formulaVersion: null, nsfEligible: false,
      locations: [{ locationId: "amazon", locationCode: "AMAZON", shippable: true, qty: 1 }],
    }];
    const held = orderStockHolds(lots, "amazon", "2026-11-01", [{ sku: "SC-PR1-1-4PK", productId: "gal", productSku: "RUST-PREVENTER-1", qty: 4 }]);
    expect(held[0]).toMatchObject({ sku: "SC-PR1-1-4PK", product: "RUST-PREVENTER-1", needed: 4, available: 1 });
    expect(lots[0].locations[0].qty).toBe(1);
    const enough = orderStockHolds(lots, "amazon", "2026-11-01", [{ sku: "SC-PR1-1-4PK", productId: "gal", productSku: "RUST-PREVENTER-1", qty: 1 }]);
    expect(enough).toEqual([]);
    expect(lots[0].locations[0].qty).toBe(0);
  });

  it("sums fees from a payments file without writing", () => {
    const row = (type: string, total: number): PaymentRow => ({
      dateTime: "2026-11-01", day: "2026-11-01", settlementId: "S1", type, orderId: "", sku: "", description: "", qty: 0,
      fulfillment: "", channel: "", productSalesCents: 0, sellingFeeCents: 0, fbaFeeCents: 0, otherTransactionFeeCents: 0,
      otherCents: 0, promotionalRebatesCents: 0, totalCents: total,
    });
    expect(paymentImportTotals([row("Service Fee", -250), row("Refund", -100), row("Transfer", -4000)])).toMatchObject({
      feeCents: 250, refunds: 1, transferCents: 4000, transfers: 1,
    });
  });
});
