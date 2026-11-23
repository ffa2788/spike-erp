import { parseCsv } from "../csv";
import { prisma } from "../db";
import type { GoliveExisting } from "../golive";
import { detectImportKind, previewBundle, sortImportFiles, type ImportFile } from "../import-bundle";
import { resolveOpeningDate, suggestedAsOf, withoutPreamble } from "../opening-date";
import { xlsxToCsv } from "../xlsx-csv";
import type { ExistingKeys } from "../peachtree";
import { err, ok, type Result } from "../result";
import type { Actor } from "./shared";
import { commitGolive } from "./golive-import";
import { commitMarketplace, commitPeachtree } from "./importers";

export async function bundleContext(): Promise<{ peachtree: ExistingKeys; golive: GoliveExisting }> {
  const [parties, products, accounts, invoices, bills, lots, formulas, boms, trial] = await Promise.all([
    prisma.party.findMany(),
    prisma.product.findMany(),
    prisma.account.findMany(),
    prisma.invoice.findMany({ select: { number: true } }),
    prisma.vendorBill.findMany({ select: { number: true } }),
    prisma.lot.findMany({ select: { lotNumber: true } }),
    prisma.formula.findMany({ where: { isDefault: true }, include: { product: true } }),
    prisma.packagedSku.findMany({ include: { outputProduct: true } }),
    prisma.journalEntry.findFirst({ where: { source: "OPENING", sourceId: "TRIAL" } }),
  ]);
  return {
    peachtree: {
      partyCodes: parties.map((party) => party.code),
      partyNames: parties.map((party) => party.nameKey),
      parties: parties.map((party) => ({ code: party.code, nameKey: party.nameKey, isCustomer: party.isCustomer, isVendor: party.isVendor })),
      skus: products.map((product) => product.sku),
      productNames: products.map((product) => product.nameKey),
      accountCodes: accounts.map((account) => account.code),
    },
    golive: {
      skus: products.map((product) => product.sku),
      partyCodes: parties.map((party) => party.code),
      accountCodes: accounts.map((account) => account.code),
      invoiceNumbers: invoices.map((invoice) => invoice.number),
      billNumbers: bills.map((bill) => bill.number),
      lotNumbers: lots.map((lot) => lot.lotNumber),
      formulaSkus: formulas.map((formula) => formula.product.sku),
      bomOutputs: boms.map((bom) => bom.outputProduct.sku),
      trialPosted: Boolean(trial),
    },
  };
}

export async function textOfUpload(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) return xlsxToCsv(new Uint8Array(await file.arrayBuffer()));
  return file.text();
}

export function filesFromForm(formData: FormData): { name: string; csv: string; kind: string }[] {
  const names = formData.getAll("name").map(String);
  const csvs = formData.getAll("csv").map(String);
  const kinds = formData.getAll("kind").map(String);
  return names.map((name, index) => ({ name, csv: csvs[index] ?? "", kind: kinds[index] ?? "" })).filter((file) => file.csv.trim());
}

export async function describeBundle(files: ImportFile[]) {
  const ready = files.map((file) => {
    const csv = withoutPreamble(file.csv);
    const headers = parseCsv(csv).headers;
    const detected = detectImportKind(headers);
    return { name: file.name, csv, source: file.csv, kind: file.kind || detected };
  });
  const preview = previewBundle(
    sortImportFiles(ready.map((file) => ({ name: file.name, csv: file.csv, kind: file.kind }))),
    await bundleContext(),
  );
  return { ...preview, asOf: suggestedAsOf(ready.map((file) => ({ kind: file.kind, csv: file.source }))) };
}

export async function commitBundle(actor: Actor, files: ImportFile[], asOf?: string | null): Promise<Result<{ saved: number; notes: string[] }>> {
  if (actor.role !== "OWNER" && actor.role !== "PARTNER") return err("Your role cannot do that.");
  const ordered = sortImportFiles(files.filter((file) => file.csv.trim() && file.kind));
  const opening = ordered.filter((file) => file.kind === "stock" || file.kind === "trial");
  let openingDate: string | null = null;
  if (opening.length) {
    const dated = resolveOpeningDate({ asOf, files: opening.map((file) => file.csv) });
    if (!dated.ok) return err(dated.error);
    openingDate = dated.date;
  }
  let saved = 0;
  const notes: string[] = [];
  for (const file of ordered) {
    const result = await commitOne(actor, { ...file, csv: withoutPreamble(file.csv) }, openingDate);
    if (!result.ok) return err(`${file.name}: ${result.error} ${saved} earlier file(s) were saved.`);
    saved += result.value.saved;
    notes.push(`${file.name}: saved ${result.value.saved}, skipped ${result.value.skipped}.`);
  }
  return ok({ saved, notes });
}

async function commitOne(actor: Actor, file: ImportFile, openingDate: string | null): Promise<Result<{ saved: number; skipped: number }>> {
  if (file.kind === "amazon" || file.kind === "walmart") {
    const result = await commitMarketplace(actor, file.csv, file.kind === "walmart" ? "WALMART" : "AMAZON");
    if (!result.ok) return result;
    return ok({ saved: result.value.invoices, skipped: 0 });
  }
  if (["stock", "ar", "ap", "trial", "formula", "bom"].includes(file.kind)) return commitGolive(actor, file.csv, file.kind, openingDate);
  return commitPeachtree(actor, file.csv, file.kind);
}
