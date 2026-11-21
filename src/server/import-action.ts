"use server";

import { parseCsv } from "@/lib/csv";
import { prisma } from "@/lib/db";
import { validateAmazonOrders } from "@/lib/amazon";
import { detectGolive, validateBoms, validateFormulas, validateOpenAp, validateOpenAr, validateStock, validateTrial, type GoliveExisting } from "@/lib/golive";
import { detectKind, validateAccounts, validateCustomers, validateItems, validateJournal } from "@/lib/peachtree";
import { commitGolive } from "@/lib/services/golive-import";
import { commitBundle, describeBundle, filesFromForm, textOfUpload } from "@/lib/services/import-bundle";
import { commitMarketplace, commitPeachtree } from "@/lib/services/importers";
import type { TieCheck } from "@/lib/import-bundle";
import { requireCan } from "./actor";

export type PeachtreeState = {
  error?: string;
  notice?: string;
  kind: string;
  csv?: string;
  ready: number;
  skipped: number;
  rows: { rowNumber: number; status: string; summary: string; messages: string[] }[];
};

async function goliveKeys(): Promise<GoliveExisting> {
  const [products, parties, accounts, invoices, bills, lots, formulas, boms, trial] = await Promise.all([
    prisma.product.findMany(),
    prisma.party.findMany(),
    prisma.account.findMany(),
    prisma.invoice.findMany({ select: { number: true } }),
    prisma.vendorBill.findMany({ select: { number: true } }),
    prisma.lot.findMany({ select: { lotNumber: true } }),
    prisma.formula.findMany({ where: { isDefault: true }, include: { product: true } }),
    prisma.packagedSku.findMany({ include: { outputProduct: true } }),
    prisma.journalEntry.findFirst({ where: { source: "OPENING", sourceId: "TRIAL" } }),
  ]);
  return {
    skus: products.map((product) => product.sku),
    partyCodes: parties.map((party) => party.code),
    accountCodes: accounts.map((account) => account.code),
    invoiceNumbers: invoices.map((invoice) => invoice.number),
    billNumbers: bills.map((bill) => bill.number),
    lotNumbers: lots.map((lot) => lot.lotNumber),
    formulaSkus: formulas.map((formula) => formula.product.sku),
    bomOutputs: boms.map((bom) => bom.outputProduct.sku),
    trialPosted: Boolean(trial),
  };
}

export async function peachtreeAction(_prev: PeachtreeState, formData: FormData): Promise<PeachtreeState> {
  const actor = await requireCan("importData");
  const file = formData.get("file");
  const pasted = String(formData.get("csv") ?? "");
  const csv = file instanceof File && file.size > 0 ? await file.text() : pasted;
  const requested = String(formData.get("kind") ?? "");
  if (!csv.trim()) return { ..._prev, error: "Choose a file or paste the rows.", rows: [] };
  if (csv.length > 2_000_000) return { ..._prev, error: "That file is too large.", rows: [] };
  if (requested === "amazon" || requested === "walmart") {
    const channel = requested === "walmart" ? "WALMART" : "AMAZON";
    const label = channel === "WALMART" ? "Walmart" : "Amazon";
    if (formData.get("commit") === "yes") {
      const result = await commitMarketplace(actor, csv, channel);
      if (!result.ok) return { kind: requested, csv, ready: 0, skipped: 0, rows: [], error: result.error };
      return { kind: requested, csv: "", ready: result.value.invoices, skipped: 0, rows: [], notice: `Imported ${result.value.invoices} ${label} orders.` };
    }
    const products = await prisma.product.findMany();
    const preview = validateAmazonOrders(parseCsv(csv).rows, products.map((product) => ({
      sku: product.sku, sellable: product.sellable, priceStatus: product.priceStatus,
    })));
    return {
      kind: requested,
      csv,
      ready: preview.ready.length,
      skipped: preview.rows.length - preview.ready.length,
      rows: preview.rows.map((row) => ({ rowNumber: row.rowNumber, status: row.status, summary: row.summary, messages: row.messages })),
    };
  }
  const table = parseCsv(csv);
  const golive = requested || detectGolive(table.headers) || "";
  if (["stock", "ar", "ap", "trial", "formula", "bom"].includes(golive)) {
    const existing = await goliveKeys();
    const preview = golive === "stock" ? validateStock(table.rows, existing)
      : golive === "ar" ? validateOpenAr(table.rows, existing)
      : golive === "ap" ? validateOpenAp(table.rows, existing)
      : golive === "trial" ? validateTrial(table.rows, existing)
      : golive === "formula" ? validateFormulas(table.rows, existing)
      : validateBoms(table.rows, existing);
    if (formData.get("commit") === "yes") {
      const result = await commitGolive(actor, csv, golive);
      if (!result.ok) return { kind: golive, csv, ready: 0, skipped: 0, rows: [], error: result.error };
      return { kind: golive, csv: "", ready: result.value.saved, skipped: result.value.skipped, rows: [], notice: `Imported ${result.value.saved}. Skipped ${result.value.skipped}.` };
    }
    return {
      kind: golive,
      csv,
      ready: preview.ready.length,
      skipped: preview.rows.length - preview.ready.length,
      rows: preview.rows.map((row) => ({ rowNumber: row.rowNumber, status: row.status, summary: row.summary, messages: row.messages })),
    };
  }
  const kind = requested || detectKind(table.headers) || "";
  if (!kind) return { kind: "", csv, ready: 0, skipped: 0, rows: [], error: "SPIKE could not tell what kind of file this is. Choose one." };
  if (formData.get("commit") === "yes") {
    const result = await commitPeachtree(actor, csv, kind);
    if (!result.ok) return { kind, csv, ready: 0, skipped: 0, rows: [], error: result.error };
    return { kind, csv: "", ready: result.value.saved, skipped: result.value.skipped, rows: [], notice: `Imported ${result.value.saved} rows. Skipped ${result.value.skipped}.` };
  }
  const [parties, products, accounts] = await Promise.all([prisma.party.findMany(), prisma.product.findMany(), prisma.account.findMany()]);
  const keys = {
    partyCodes: parties.map((party) => party.code),
    partyNames: parties.map((party) => party.nameKey),
    parties: parties.map((party) => ({ code: party.code, nameKey: party.nameKey, isCustomer: party.isCustomer, isVendor: party.isVendor })),
    skus: products.map((product) => product.sku),
    productNames: products.map((product) => product.nameKey),
    accountCodes: accounts.map((account) => account.code),
  };
  const preview = kind === "customers" || kind === "vendors"
    ? validateCustomers(table.rows, keys, kind === "vendors")
    : kind === "items"
      ? validateItems(table.rows, keys)
      : kind === "accounts"
        ? validateAccounts(table.rows, keys)
        : validateJournal(table.rows, keys);
  const rows = "rows" in preview ? preview.rows : [];
  const ready = "ready" in preview ? preview.ready.length : 0;
  return {
    kind,
    csv,
    ready,
    skipped: rows.length - ready,
    rows: rows.map((row) => ({ rowNumber: row.rowNumber, status: row.status, summary: row.summary, messages: row.messages })),
  };
}

export type BundleState = {
  error?: string;
  notice?: string;
  okRows: number;
  files: { name: string; kind: string; detected: string; csv: string; ready: number }[];
  errors: { file: string; rowNumber: number; summary: string; messages: string[] }[];
  roles: { file: string; rowNumber: number; summary: string; messages: string[] }[];
  checks: TieCheck[];
};

async function uploads(formData: FormData) {
  const listed = filesFromForm(formData);
  if (listed.length) return listed;
  const files = formData.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
  return Promise.all(files.map(async (file) => ({ name: file.name, csv: await textOfUpload(file), kind: "" })));
}

export async function previewBundleAction(formData: FormData): Promise<BundleState> {
  await requireCan("importData");
  const files = await uploads(formData);
  if (!files.length) return { error: "Drop at least one file.", okRows: 0, files: [], errors: [], roles: [], checks: [] };
  const preview = await describeBundle(files);
  return {
    okRows: preview.okRows,
    files: preview.files.map((file) => ({ name: file.name, kind: file.kind, detected: file.detected, csv: file.csv, ready: file.ready })),
    errors: preview.errorRows.map((row) => ({ file: row.file, rowNumber: row.rowNumber, summary: row.summary, messages: row.messages })),
    roles: preview.roleRows.map((row) => ({ file: row.file, rowNumber: row.rowNumber, summary: row.summary, messages: row.messages })),
    checks: preview.checks,
  };
}

export async function commitBundleAction(formData: FormData): Promise<BundleState> {
  const actor = await requireCan("importData");
  const files = filesFromForm(formData);
  const result = await commitBundle(actor, files);
  if (!result.ok) return { error: result.error, okRows: 0, files: [], errors: [], roles: [], checks: [] };
  return { notice: result.value.notes.join(" "), okRows: result.value.saved, files: [], errors: [], roles: [], checks: [] };
}
