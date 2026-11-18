import { describe, expect, it } from "vitest";
import { amazonConnection, parseFbaInventory, parseOrdersPayload } from "@/lib/amazon-sp";
import { SDS_TITLES, buildSds, buildTds } from "@/lib/sds";
import { mayShowNsfMark } from "@/lib/nsf-listings";

describe("Amazon connection", () => {
  it("stays disconnected until every credential is present", () => {
    expect(amazonConnection({}).connected).toBe(false);
    expect(amazonConnection({ AMAZON_LWA_CLIENT_ID: "id" }).missing).toContain("AMAZON_REFRESH_TOKEN");
    const full = Object.fromEntries(["AMAZON_LWA_CLIENT_ID", "AMAZON_LWA_CLIENT_SECRET", "AMAZON_REFRESH_TOKEN", "AMAZON_SELLER_ID", "AMAZON_MARKETPLACE_ID", "AMAZON_AWS_ACCESS_KEY_ID", "AMAZON_AWS_SECRET_ACCESS_KEY"].map((key) => [key, "x"]));
    expect(amazonConnection(full).connected).toBe(true);
  });

  it("reads real order and FBA payloads and does not invent rows", () => {
    const orders = parseOrdersPayload(JSON.stringify({ payload: { Orders: [{ AmazonOrderId: "111-1", PurchaseDate: "2026-11-01T00:00:00Z" }] } }));
    expect(orders).toEqual([{ orderId: "111-1", date: "2026-11-01", sku: "", qty: 0, itemPriceCents: 0 }]);
    const items = parseOrdersPayload(JSON.stringify({ payload: { OrderItems: [{ SellerSKU: "POLY-BEAD", QuantityOrdered: 2, ItemPrice: { Amount: "6.20" } }] } }));
    expect(items[0].itemPriceCents).toBe(620);
    expect(parseFbaInventory("seller-sku\tQuantity Available\nPOLY-BEAD\t4\n")).toEqual([{ sku: "POLY-BEAD", available: 4 }]);
    expect(parseFbaInventory("")).toEqual([]);
  });
});

describe("SDS and the NSF mark", () => {
  const base = {
    productName: "Example",
    sku: "EX",
    company: "SPER Chemical",
    address: "Clearwater, FL",
    phone: "727-535-9033",
    revision: "2026-11-14",
    version: 1,
    form: "Liquid",
    appearance: "Clear",
    specificGravity: "1.20",
    ph: "6.5",
    flashPoint: "",
    solubility: "Soluble",
    signal: "Warning",
    classification: "Eye irritation",
    pictograms: "exclamation",
    hazardStatements: "Causes eye irritation.",
    precautionary: "Wear eye protection.",
    unNumber: "",
    shippingName: "",
    transportClass: "",
    packingGroup: "",
    ingredients: [{ name: "Phosphate", cas: "68915-31-1", percent: 35, classification: "Not classified", signal: "", pictograms: "", hazardStatements: "", precautionary: "" }],
    nsf: null,
    description: "Example liquid.",
  };

  it("builds all 16 HazCom sections and withholds the mark when there is no listing", () => {
    const sds = buildSds(base);
    expect(sds.sections.map((section) => section.title)).toEqual([...SDS_TITLES]);
    expect(sds.sections[0].body).toMatch(/not on SPER/i);
    expect(sds.sections[2].body).toMatch(/35.00%/);
    expect(buildTds(base).lines.find((line) => line.label.startsWith("NSF"))?.value).toMatch(/No NSF mark/);
    expect(mayShowNsfMark(null)).toBe(false);
    expect(mayShowNsfMark({ active: true, tradeName: "PolyPhos Beads" })).toBe(true);
    expect(mayShowNsfMark({ active: false, tradeName: "PolyPhos Beads" })).toBe(false);
  });

  it("names the listed trade name and max use only when a listing is attached", () => {
    const listed = buildSds({ ...base, nsf: { tradeName: "PolyPhos Beads", maxUseMgL: "13", function: "Corrosion control" } });
    expect(listed.sections[0].body).toMatch(/PolyPhos Beads/);
    expect(listed.sections[0].body).toMatch(/13 mg\/L/);
    expect(listed.sections[14].body).toMatch(/13 mg\/L/);
  });
});
