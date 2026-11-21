import { CODES } from "./chart";
import { parseCsv } from "./csv";
import { detectGolive, validateBoms, validateFormulas, validateOpenAp, validateOpenAr, validateStock, validateTrial, type GoliveExisting } from "./golive";
import { valueCents } from "./inventory";
import { detectKind, validateAccounts, validateCustomers, validateItems, validateJournal, type ExistingKeys } from "./peachtree";
import { nameKey } from "./names";

export const IMPORT_ORDER = [
  "customers",
  "vendors",
  "items",
  "accounts",
  "journal",
  "formula",
  "bom",
  "trial",
  "stock",
  "ar",
  "ap",
  "amazon",
  "walmart",
] as const;

export const KIND_LABEL: Record<string, string> = {
  customers: "Customers",
  vendors: "Suppliers",
  items: "Items",
  accounts: "Accounts",
  journal: "Journal",
  formula: "Formulas",
  bom: "Packaging lists",
  trial: "Opening trial balance",
  stock: "Opening stock count",
  ar: "Open customer invoices",
  ap: "Open vendor bills",
  amazon: "Amazon orders",
  walmart: "Walmart orders",
};

const INVENTORY_ACCOUNTS = [CODES.invRaw, CODES.invFg, CODES.wip, CODES.shipped, CODES.packaging];

export type ImportFile = { name: string; csv: string; kind: string };

export type BundleRow = { file: string; rowNumber: number; status: string; summary: string; messages: string[] };

export type TieCheck = { name: string; ok: boolean; detail: string };

export function importRank(kind: string): number {
  const index = IMPORT_ORDER.indexOf(kind as (typeof IMPORT_ORDER)[number]);
  return index === -1 ? IMPORT_ORDER.length : index;
}

export function detectImportKind(headers: string[]): string {
  return detectGolive(headers) || detectKind(headers) || "";
}

export function sortImportFiles<T extends { kind: string; name: string }>(files: T[]): T[] {
  return files
    .map((file, index) => ({ file, index }))
    .sort((a, b) => importRank(a.file.kind) - importRank(b.file.kind) || a.index - b.index)
    .map((item) => item.file);
}

export function tieOut(input: {
  trial: { accountCode: string; debitCents: number; creditCents: number }[];
  stockCents: number | null;
  arCents: number | null;
  apCents: number | null;
}): TieCheck[] {
  const checks: TieCheck[] = [];
  if (input.trial.length === 0) {
    checks.push({ name: "Trial balance", ok: true, detail: "No trial balance in this drop." });
  } else {
    const debit = input.trial.reduce((sum, line) => sum + line.debitCents, 0);
    const credit = input.trial.reduce((sum, line) => sum + line.creditCents, 0);
    checks.push({
      name: "Trial balance",
      ok: debit === credit && debit > 0,
      detail: debit === credit ? `Debits and credits both $${(debit / 100).toFixed(2)}.` : `Debits $${(debit / 100).toFixed(2)} and credits $${(credit / 100).toFixed(2)} do not match.`,
    });
  }
  checks.push(compare("Stock and inventory accounts", input.stockCents, accountNet(input.trial, INVENTORY_ACCOUNTS, "debit"), "the inventory accounts"));
  checks.push(compare("Open invoices and account 1100", input.arCents, accountNet(input.trial, [CODES.ar], "debit"), "account 1100"));
  checks.push(compare("Open bills and account 2000", input.apCents, accountNet(input.trial, [CODES.ap], "credit"), "account 2000"));
  return checks;
}

function compare(name: string, detailCents: number | null, glCents: number | null, glName: string): TieCheck {
  if (detailCents == null) return { name, ok: true, detail: "Not in this drop." };
  if (glCents == null) return { name, ok: true, detail: `$${(detailCents / 100).toFixed(2)} in the files. Add the trial balance to compare with ${glName}.` };
  const ok = detailCents === glCents;
  return {
    name,
    ok,
    detail: ok
      ? `Both $${(detailCents / 100).toFixed(2)}.`
      : `Files say $${(detailCents / 100).toFixed(2)} and ${glName} say $${(glCents / 100).toFixed(2)}.`,
  };
}

function accountNet(lines: { accountCode: string; debitCents: number; creditCents: number }[], codes: string[], normal: "debit" | "credit"): number | null {
  const picked = lines.filter((line) => codes.includes(line.accountCode));
  if (picked.length === 0) return null;
  const net = picked.reduce((sum, line) => sum + line.debitCents - line.creditCents, 0);
  return normal === "debit" ? net : -net;
}

export type BundlePreview = {
  files: { name: string; kind: string; detected: string; csv: string; ready: number; rows: BundleRow[] }[];
  checks: TieCheck[];
  okRows: number;
  errorRows: BundleRow[];
  roleRows: BundleRow[];
};

export function previewBundle(
  files: ImportFile[],
  existing: { peachtree: ExistingKeys; golive: GoliveExisting },
): BundlePreview {
  const peach: ExistingKeys = {
    partyCodes: [...existing.peachtree.partyCodes],
    partyNames: [...existing.peachtree.partyNames],
    parties: existing.peachtree.parties?.map((party) => ({ ...party })),
    skus: [...existing.peachtree.skus],
    productNames: [...existing.peachtree.productNames],
    accountCodes: [...existing.peachtree.accountCodes],
  };
  const live: GoliveExisting = {
    ...existing.golive,
    skus: [...existing.golive.skus],
    partyCodes: [...existing.golive.partyCodes],
    accountCodes: [...existing.golive.accountCodes],
    invoiceNumbers: [...existing.golive.invoiceNumbers],
    billNumbers: [...existing.golive.billNumbers],
    lotNumbers: [...existing.golive.lotNumbers],
    formulaSkus: [...existing.golive.formulaSkus],
    bomOutputs: [...existing.golive.bomOutputs],
  };
  const ordered = sortImportFiles(files);
  const described = [];
  let trial: { accountCode: string; debitCents: number; creditCents: number }[] = [];
  let stockCents: number | null = null;
  let arCents: number | null = null;
  let apCents: number | null = null;
  for (const file of ordered) {
    const table = parseCsv(file.csv);
    const detected = detectImportKind(table.headers);
    const kind = file.kind || detected;
    const rows = rowsFor(kind, table.rows, peach, live);
    if (kind === "trial") trial = validateTrial(table.rows, live).ready;
    if (kind === "stock") {
      const ready = validateStock(table.rows, live).ready;
      stockCents = (stockCents ?? 0) + ready.reduce((sum, row) => sum + valueCents(row.qty, row.unitCost), 0);
    }
    if (kind === "ar") {
      const ready = validateOpenAr(table.rows, live).ready;
      arCents = (arCents ?? 0) + ready.reduce((sum, row) => sum + row.amountCents, 0);
    }
    if (kind === "ap") {
      const ready = validateOpenAp(table.rows, live).ready;
      apCents = (apCents ?? 0) + ready.reduce((sum, row) => sum + row.amountCents, 0);
    }
    remember(kind, table.rows, peach, live);
    described.push({
      name: file.name,
      kind,
      detected,
      csv: file.csv,
      ready: rows.filter((row) => row.status !== "error").length,
      rows: rows.map((row) => ({ file: file.name, ...row })),
    });
  }
  const errorRows = described.flatMap((file) => file.rows.filter((row) => row.status === "error"));
  const roleRows = described.flatMap((file) => file.rows.filter((row) => row.status === "role added"));
  const okRows = described.reduce((sum, file) => sum + file.rows.filter((row) => row.status !== "error").length, 0);
  return { files: described, checks: tieOut({ trial, stockCents, arCents, apCents }), okRows, errorRows, roleRows };
}

function rowsFor(kind: string, rows: Record<string, string>[], peach: ExistingKeys, live: GoliveExisting): { rowNumber: number; status: string; summary: string; messages: string[] }[] {
  if (!kind) return [{ rowNumber: 2, status: "error", summary: "Unknown file", messages: ["SPIKE could not tell what this file is. Choose a kind."] }];
  if (kind === "customers" || kind === "vendors") return validateCustomers(rows, peach, kind === "vendors").rows;
  if (kind === "items") return validateItems(rows, peach).rows;
  if (kind === "accounts") return validateAccounts(rows, peach).rows;
  if (kind === "journal") return validateJournal(rows, peach).rows;
  if (kind === "stock") return validateStock(rows, live).rows;
  if (kind === "ar") return validateOpenAr(rows, live).rows;
  if (kind === "ap") return validateOpenAp(rows, live).rows;
  if (kind === "trial") return validateTrial(rows, live).rows;
  if (kind === "formula") return validateFormulas(rows, live).rows;
  if (kind === "bom") return validateBoms(rows, live).rows;
  return [{ rowNumber: 2, status: "error", summary: kind, messages: ["That kind is not one of the cutover files."] }];
}

function remember(kind: string, rows: Record<string, string>[], peach: ExistingKeys, live: GoliveExisting) {
  if (kind === "customers" || kind === "vendors") {
    for (const row of validateCustomers(rows, peach, kind === "vendors").ready) {
      const code = row.code.toUpperCase();
      const found = peach.parties?.find((party) => party.code.toUpperCase() === code);
      if (found) {
        if (kind === "vendors") found.isVendor = true;
        else found.isCustomer = true;
      } else {
        peach.parties = peach.parties ?? [];
        peach.parties.push({ code, nameKey: nameKey(row.name), isCustomer: kind === "customers", isVendor: kind === "vendors" });
        peach.partyCodes.push(row.code);
        live.partyCodes.push(row.code);
      }
    }
  }
  if (kind === "items") {
    for (const row of validateItems(rows, peach).ready) {
      peach.skus.push(row.sku);
      live.skus.push(row.sku);
    }
  }
  if (kind === "accounts") {
    for (const row of validateAccounts(rows, peach).ready) {
      peach.accountCodes.push(row.code);
      live.accountCodes.push(row.code);
    }
  }
  if (kind === "stock") for (const row of validateStock(rows, live).ready) live.lotNumbers.push(row.lotNumber);
  if (kind === "ar") for (const row of validateOpenAr(rows, live).ready) live.invoiceNumbers.push(row.number);
  if (kind === "ap") for (const row of validateOpenAp(rows, live).ready) live.billNumbers.push(row.number);
  if (kind === "formula") for (const row of validateFormulas(rows, live).ready) live.formulaSkus.push(row.sku);
  if (kind === "bom") for (const row of validateBoms(rows, live).ready) live.bomOutputs.push(row.outputSku);
  if (kind === "trial" && validateTrial(rows, live).ready.length > 0) live.trialPosted = true;
}
