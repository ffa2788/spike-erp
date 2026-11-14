"use server";

import { parseDateInput } from "@/lib/dates";
import { generateDocument, publishDocument, reviewDocument } from "@/lib/services/documents";
import { packGoods } from "@/lib/services/pack";
import { prisma } from "@/lib/db";
import { NSF_LISTED_AS_OF, NSF_LISTING_SOURCE, NSF_PUBLIC_LISTING } from "@/lib/nsf-listings";
import { amazonConnection, lwaAccessToken, parseFbaInventory, parseOrdersPayload, spGet } from "@/lib/amazon-sp";
import { createAmazonSale } from "@/lib/services/sales";
import { requireCan } from "./actor";
import { fail, succeed } from "./http";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function savePoundsFormula(formData: FormData) {
  const actor = await requireCan("editMasters");
  const productId = text(formData, "productId");
  const back = `/products/${productId}/formula`;
  const ids = formData.getAll("ingredientId").map(String);
  const pounds = formData.getAll("pounds").map(String);
  const lines = [];
  for (let i = 0; i < ids.length; i++) {
    if (!ids[i] || !pounds[i]) continue;
    const weight = Number(pounds[i]);
    if (!(weight > 0)) fail(back, "Every ingredient needs a weight in pounds greater than zero.");
    lines.push({ ingredientId: ids[i], pounds: weight });
  }
  const gravity = text(formData, "specificGravity");
  const { addFormulaVersion } = await import("@/lib/services/masters");
  const result = await addFormulaVersion(actor, {
    productId,
    batchQty: 1,
    notes: text(formData, "notes"),
    makeDefault: true,
    specificGravity: gravity ? Number(gravity) : null,
    lines,
  });
  if (!result.ok) fail(back, result.error);
  succeed(back, "Formula version saved. The weights were converted to percents that add up to 100.");
}

export async function packAction(formData: FormData) {
  const actor = await requireCan("produce");
  const id = text(formData, "packagedSkuId");
  const back = text(formData, "back") || "/products";
  const units = Number(text(formData, "units"));
  const date = parseDateInput(text(formData, "packedOn"));
  if (!date) fail(back, "Enter a date.");
  const result = await packGoods(actor, { packagedSkuId: id, units, packedOn: date });
  if (!result.ok) fail(back, result.error);
  succeed(back, "The packages were made. Packaging and bulk product were taken out of inventory.");
}

export async function generateDocAction(formData: FormData) {
  const actor = await requireCan("editMasters");
  const productId = text(formData, "productId");
  const kind = text(formData, "kind") === "SDS" ? "SDS" : "TDS";
  const result = await generateDocument(actor, productId, kind);
  if (!result.ok) fail(`/documents`, result.error);
  succeed(`/documents/${result.value.id}`, `${kind} draft created. A qualified person must review it before it is released.`);
}

export async function reviewDocAction(formData: FormData) {
  const actor = await requireCan("releaseQc");
  const id = text(formData, "id");
  const result = await reviewDocument(actor, id, text(formData, "note"));
  if (!result.ok) fail(`/documents/${id}`, result.error);
  succeed(`/documents/${id}`, "Review recorded. You can publish this version now.");
}

export async function publishDocAction(formData: FormData) {
  const actor = await requireCan("releaseQc");
  const id = text(formData, "id");
  const result = await publishDocument(actor, id);
  if (!result.ok) fail(`/documents/${id}`, result.error);
  succeed(`/documents/${id}`, "Published. This is the released version.");
}

export async function linkNsfAction(formData: FormData) {
  const actor = await requireCan("editMasters");
  const productId = text(formData, "productId");
  const listingId = text(formData, "listingId");
  const product = await prisma.product.findUnique({ where: { id: productId } });
  const listing = listingId ? await prisma.nsfListing.findUnique({ where: { id: listingId } }) : null;
  if (!product) fail("/settings/nsf", "That product was not found.");
  if (listingId && (!listing || !listing.active)) fail("/settings/nsf", "Choose a trade name from the NSF public listing.");
  await prisma.product.update({
    where: { id: productId },
    data: {
      nsfListingId: listing?.id ?? null,
      nsfCertified: Boolean(listing),
      nsfFormulaVersion: listing ? product.nsfFormulaVersion ?? 1 : null,
      nsfClaim: listing ? `Listed as ${listing.tradeName}. Max use ${Number(listing.maxUseMgL)} mg/L.` : "",
      nsfBody: listing ? "NSF" : "",
    },
  });
  const { audit } = await import("@/lib/services/shared");
  await prisma.$transaction((tx) =>
    audit(tx, actor, "update", "Product", productId, listing ? `Linked ${product.sku} to NSF listing ${listing.tradeName}.` : `Removed the NSF listing from ${product.sku}.`),
  );
  succeed("/settings/nsf", listing ? "The NSF mark will show on this product." : "The NSF mark was removed.");
}

export async function refreshNsfListing() {
  const actor = await requireCan("editMasters");
  for (const row of NSF_PUBLIC_LISTING) {
    await prisma.nsfListing.upsert({
      where: { tradeName: row.tradeName },
      update: { category: row.category, function: row.function, maxUseMgL: row.maxUseMgL, sourceUrl: NSF_LISTING_SOURCE, listedAsOf: new Date(`${NSF_LISTED_AS_OF}T12:00:00Z`), active: true },
      create: { ...row, sourceUrl: NSF_LISTING_SOURCE, listedAsOf: new Date(`${NSF_LISTED_AS_OF}T12:00:00Z`) },
    });
  }
  const { audit } = await import("@/lib/services/shared");
  await prisma.$transaction((tx) => audit(tx, actor, "update", "NsfListing", "public", `Refreshed the NSF public listing captured on ${NSF_LISTED_AS_OF}.`));
  succeed("/settings/nsf", "Listing updated from the copy captured on 14 November 2026. Check info.nsf.org if NSF has changed it since then.");
}

export async function pullAmazonOrders() {
  const actor = await requireCan("importData");
  const connection = amazonConnection();
  if (!connection.connected) fail("/sales/amazon", "Amazon is not connected.");
  try {
    const token = await lwaAccessToken(process.env);
    const createdAfter = new Date(Date.now() - 14 * 86400000).toISOString();
    const query = `MarketplaceIds=${encodeURIComponent(process.env.AMAZON_MARKETPLACE_ID!)}&CreatedAfter=${encodeURIComponent(createdAfter)}`;
    const ordersBody = await spGet({ env: process.env, path: "/orders/v0/orders", query, accessToken: token });
    const orders = parseOrdersPayload(ordersBody).filter((order) => order.orderId);
    const amazon = await prisma.party.findFirst({ where: { channel: "AMAZON", isCustomer: true } });
    if (!amazon) fail("/sales/amazon", "Add the Amazon customer before posting orders.");
    let posted = 0;
    for (const order of orders.slice(0, 25)) {
      const itemsBody = await spGet({
        env: process.env,
        path: `/orders/v0/orders/${encodeURIComponent(order.orderId)}/orderItems`,
        accessToken: token,
      });
      const items = parseOrdersPayload(itemsBody);
      for (const item of items) {
        const product = await prisma.product.findFirst({ where: { sku: item.sku.toUpperCase() } });
        if (!product || item.itemPriceCents <= 0) continue;
        const result = await createAmazonSale(actor, {
          partyId: amazon.id,
          orderId: order.orderId,
          date: new Date(`${order.date || new Date().toISOString().slice(0, 10)}T12:00:00Z`),
          productId: product.id,
          qty: item.qty,
          itemPriceCents: item.itemPriceCents,
          feeCents: 0,
        });
        if (!result.ok) fail("/sales/amazon", result.error);
        posted += 1;
      }
    }
    succeed("/sales/amazon", posted ? `Posted ${posted} Amazon order lines into sales.` : "Amazon returned no order lines with a matching SKU.");
  } catch (error) {
    fail("/sales/amazon", error instanceof Error ? error.message : "Amazon could not be reached.");
  }
}

export async function pullFbaInventory() {
  const actor = await requireCan("importData");
  if (!amazonConnection().connected) fail("/sales/amazon", "Amazon is not connected.");
  try {
    const token = await lwaAccessToken(process.env);
    const created = await spGet({
      env: process.env,
      path: "/reports/2021-06-30/reports",
      query: "reportTypes=GET_AFN_INVENTORY_DATA&pageSize=1",
      accessToken: token,
    });
    const report = JSON.parse(created) as { reports?: { reportDocumentId?: string; processingStatus?: string }[] };
    const documentId = report.reports?.find((item) => item.processingStatus === "DONE")?.reportDocumentId;
    if (!documentId) {
      succeed("/sales/amazon", "Amazon has no finished FBA inventory report yet. Request one in Seller Central, then pull again. Nothing was invented.");
    }
    const document = JSON.parse(await spGet({ env: process.env, path: `/reports/2021-06-30/documents/${documentId}`, accessToken: token })) as { url?: string };
    if (!document.url) fail("/sales/amazon", "Amazon did not give a report file.");
    const file = await fetch(document.url);
    const rows = parseFbaInventory(await file.text());
    const location = await prisma.location.findUnique({ where: { code: "AMAZON" } });
    if (!location) fail("/sales/amazon", "The Amazon location is not set up.");
    let updated = 0;
    for (const row of rows) {
      const product = await prisma.product.findFirst({ where: { sku: row.sku.toUpperCase(), trackInventory: true } });
      if (!product) continue;
      const { adjustLot } = await import("@/lib/services/money");
      const result = await adjustLot(actor, {
        lotId: (await prisma.lot.findFirst({ where: { productId: product.id, notes: { contains: "FBA" } } }))?.id ?? "",
        locationId: location.id,
        newQty: row.available,
        reason: `FBA inventory report from Amazon for ${row.sku}`,
        date: new Date(),
      });
      if (!result.ok && !result.error.includes("not found")) fail("/sales/amazon", result.error);
      updated += result.ok ? 1 : 0;
    }
    succeed("/sales/amazon", `Read ${rows.length} FBA rows. Updated ${updated} lots that were already tagged FBA. SKUs without that lot were left unchanged.`);
  } catch (error) {
    fail("/sales/amazon", error instanceof Error ? error.message : "Amazon could not be reached.");
  }
}
