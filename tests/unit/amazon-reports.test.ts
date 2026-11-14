import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_ORDERS_HEADERS, dedupeOrders, parseAllOrders, parseFbaManageInventory, suggestAmazonSku } from "@/lib/amazon-reports";

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

  it("suggests the known ASINs and leaves junk listed rather than matched to a product", () => {
    const products = [
      { id: "gal", sku: "RUST-1G", name: "SPER Rust Preventer, 1 gal" },
      { id: "rem", sku: "RUST-REM", name: "SPER Rust Remover" },
    ];
    expect(suggestAmazonSku({ sku: "SC-RP1-1.0-1", asin: "B0BZLYZQ2P", products }).productId).toBe("gal");
    expect(suggestAmazonSku({ sku: "SPER-RR-1.0-1-FBA", asin: "B0CTQ5MFNQ", products }).productId).toBe("rem");
    const two = suggestAmazonSku({ sku: "SPER-RP-2.5-1-FBA", asin: "B0CTQ1TFCT", products });
    expect(two.label).toBe("Rust Preventer 2.5 gal");
    expect(two.productId).toBeNull();
    const junk = suggestAmazonSku({ sku: "B0CTQ1TFCT.missing01", asin: "", products });
    expect(junk.label).toBe("Rust Preventer 2.5 gal");
    expect(junk.productId).toBeNull();
  });
});
