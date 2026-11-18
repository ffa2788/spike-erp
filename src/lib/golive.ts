import { CODES } from "./chart";
import { parseLooseDate } from "./dates";
import { cleanCode } from "./names";
import { parseMoneyToCents } from "./pricing";
import { normHeader, pick } from "./csv";
import type { PreviewRow } from "./peachtree";

export type GoliveKind = "stock" | "ar" | "ap" | "trial" | "formula" | "bom";

export function detectGolive(headers: string[]): GoliveKind | null {
  const names = headers.map(normHeader);
  const has = (...keys: string[]) => keys.some((key) => names.includes(key));
  if (has("finishedsku") && has("ingredient", "ingredientsku")) return "formula";
  if (has("packagingsku")) return "bom";
  if (has("invoicenumber", "invoicecm") && has("customerid")) return "ar";
  if (has("billnumber") && has("vendorid")) return "ap";
  if (has("quantity", "qty") && has("unitcost") && has("itemid", "sku") && !has("itemdescription")) return "stock";
  if (has("debit") && has("accountid", "accountnumber") && !has("date") && !has("reference")) return "trial";
  return null;
}

export type StockRow = { sku: string; qty: number; unitCost: number; lotNumber: string };
export type OpenArRow = { customerCode: string; number: string; date: string; due: string; amountCents: number; description: string };
export type OpenApRow = { vendorCode: string; number: string; date: string; due: string; amountCents: number; description: string };
export type TrialRow = { accountCode: string; debitCents: number; creditCents: number };
export type FormulaGroup = { sku: string; lines: { ingredientSku: string; percent: number }[] };
export type BomGroup = {
  outputSku: string;
  bulkSku: string;
  packageCode: string;
  unitsPerCase: number;
  casesPerPallet: number;
  lines: { materialSku: string; qty: number; basis: "UNIT" | "CASE" | "PALLET" }[];
};

export type GoliveExisting = {
  skus: string[];
  partyCodes: string[];
  accountCodes: string[];
  invoiceNumbers: string[];
  billNumbers: string[];
  lotNumbers: string[];
  formulaSkus: string[];
  bomOutputs: string[];
  trialPosted: boolean;
};

function money(raw: string): number | null {
  if (!raw.trim()) return null;
  return parseMoneyToCents(raw);
}

export function validateStock(rows: Record<string, string>[], existing: GoliveExisting) {
  const seen = new Set(existing.lotNumbers.map((lot) => lot.toUpperCase()));
  const skus = new Set(existing.skus.map((sku) => sku.toUpperCase()));
  const preview: (PreviewRow & { data: StockRow | null })[] = [];
  for (const [index, row] of rows.entries()) {
    const messages: string[] = [];
    const sku = cleanCode(pick(row, "Item ID", "SKU"));
    const qty = Number(pick(row, "Quantity", "Qty"));
    const costRaw = pick(row, "Unit Cost", "Cost");
    const costCents = money(costRaw);
    const lotNumber = cleanCode(pick(row, "Lot Number", "Lot")) || `OPEN-${sku}`;
    if (!sku || !skus.has(sku)) messages.push(`Item ${sku || "(blank)"} is not on the item list. Import items first.`);
    if (!(qty > 0)) messages.push("Quantity must be greater than zero.");
    if (costCents == null || costCents <= 0) messages.push("Unit cost must be a number greater than zero.");
    if (seen.has(lotNumber)) messages.push(`Lot ${lotNumber} is already on file. This row will be skipped on a second import.`);
    const data = messages.length ? null : { sku, qty, unitCost: (costCents ?? 0) / 100, lotNumber };
    if (data) seen.add(lotNumber);
    preview.push({ rowNumber: index + 2, status: data ? "ok" : messages.some((m) => m.includes("already on file")) ? "warning" : "error", messages, summary: `${sku} · ${qty || "?"} @ ${costRaw || "?"}`, data });
  }
  return { rows: preview, ready: preview.flatMap((row) => (row.data ? [row.data] : [])) };
}

export function validateOpenAr(rows: Record<string, string>[], existing: GoliveExisting) {
  const parties = new Set(existing.partyCodes.map((code) => code.toUpperCase()));
  const numbers = new Set(existing.invoiceNumbers.map((number) => number.toUpperCase()));
  const preview: (PreviewRow & { data: OpenArRow | null })[] = [];
  for (const [index, row] of rows.entries()) {
    const messages: string[] = [];
    const customerCode = cleanCode(pick(row, "Customer ID", "Cust ID"));
    const number = pick(row, "Invoice Number", "Invoice/CM #", "Invoice").trim();
    const date = parseLooseDate(pick(row, "Date", "Invoice Date"));
    const due = parseLooseDate(pick(row, "Due Date", "Due")) || date;
    const amount = money(pick(row, "Amount", "Balance", "Open Balance"));
    if (!customerCode || !parties.has(customerCode)) messages.push(`Customer ${customerCode || "(blank)"} is not on file.`);
    if (!number) messages.push("Every open invoice needs its Peachtree invoice number.");
    else if (numbers.has(number.toUpperCase())) messages.push(`Invoice ${number} is already on file.`);
    if (!date) messages.push("Date must look like 2026-11-01 or 11/01/2026.");
    if (amount == null || amount <= 0) messages.push("Amount must be greater than zero.");
    const data = messages.length || !date || !due || amount == null ? null : {
      customerCode, number, date, due, amountCents: amount, description: pick(row, "Description", "Memo") || `Opening invoice ${number}`,
    };
    if (data) numbers.add(number.toUpperCase());
    preview.push({ rowNumber: index + 2, status: data ? "ok" : "error", messages, summary: number || customerCode || "(blank)", data });
  }
  return { rows: preview, ready: preview.flatMap((row) => (row.data ? [row.data] : [])) };
}

export function validateOpenAp(rows: Record<string, string>[], existing: GoliveExisting) {
  const parties = new Set(existing.partyCodes.map((code) => code.toUpperCase()));
  const numbers = new Set(existing.billNumbers.map((number) => number.toUpperCase()));
  const preview: (PreviewRow & { data: OpenApRow | null })[] = [];
  for (const [index, row] of rows.entries()) {
    const messages: string[] = [];
    const vendorCode = cleanCode(pick(row, "Vendor ID", "Supplier ID"));
    const theirNumber = pick(row, "Bill Number", "Invoice Number", "Reference").trim();
    const number = theirNumber;
    const date = parseLooseDate(pick(row, "Date", "Bill Date"));
    const due = parseLooseDate(pick(row, "Due Date", "Due")) || date;
    const amount = money(pick(row, "Amount", "Balance", "Open Balance"));
    if (!vendorCode || !parties.has(vendorCode)) messages.push(`Vendor ${vendorCode || "(blank)"} is not on file.`);
    if (!number) messages.push("Every open bill needs the vendor's invoice number.");
    else if (numbers.has(number.toUpperCase())) messages.push(`Bill ${number} is already on file.`);
    if (!date) messages.push("Date must look like 2026-11-01 or 11/01/2026.");
    if (amount == null || amount <= 0) messages.push("Amount must be greater than zero.");
    const data = messages.length || !date || !due || amount == null ? null : {
      vendorCode, number, date, due, amountCents: amount, description: pick(row, "Description", "Memo") || `Opening bill ${number}`,
    };
    if (data) numbers.add(number.toUpperCase());
    preview.push({ rowNumber: index + 2, status: data ? "ok" : "error", messages, summary: number || vendorCode || "(blank)", data });
  }
  return { rows: preview, ready: preview.flatMap((row) => (row.data ? [row.data] : [])) };
}

export function validateTrial(rows: Record<string, string>[], existing: GoliveExisting) {
  const accounts = new Set(existing.accountCodes);
  const preview: PreviewRow[] = [];
  const lines: TrialRow[] = [];
  let sawOpening = false;
  if (existing.trialPosted) {
    return {
      rows: rows.map((row, index) => ({
        rowNumber: index + 2,
        status: "warning" as const,
        messages: ["The opening trial balance is already posted. Importing it again does nothing."],
        summary: pick(row, "Account ID", "Account Number") || "(row)",
      })),
      ready: [] as TrialRow[],
    };
  }
  for (const [index, row] of rows.entries()) {
    const messages: string[] = [];
    const accountCode = cleanCode(pick(row, "Account ID", "Account Number"));
    const debit = money(pick(row, "Debit")) ?? 0;
    const credit = money(pick(row, "Credit")) ?? 0;
    if (!accountCode || !accounts.has(accountCode)) messages.push(`Account ${accountCode || "(blank)"} is not on the chart.`);
    if (pick(row, "Debit") && money(pick(row, "Debit")) == null) messages.push("Debit is not a number.");
    if (pick(row, "Credit") && money(pick(row, "Credit")) == null) messages.push("Credit is not a number.");
    if (debit > 0 && credit > 0) messages.push("Use a debit or a credit, not both.");
    if (debit === 0 && credit === 0) messages.push("Enter a debit or a credit.");
    if (accountCode === CODES.obe && (debit > 0 || credit > 0)) sawOpening = true;
    if (!messages.length) lines.push({ accountCode, debitCents: debit, creditCents: credit });
    preview.push({ rowNumber: index + 2, status: messages.length ? "error" : "ok", messages, summary: accountCode || "(blank)" });
  }
  const debit = lines.reduce((sum, line) => sum + line.debitCents, 0);
  const credit = lines.reduce((sum, line) => sum + line.creditCents, 0);
  const problems: string[] = [];
  if (preview.some((row) => row.status === "error")) problems.push("Fix the row errors before the trial balance can post.");
  if (lines.length >= 2 && debit !== credit) {
    problems.push(`The trial balance does not balance. Debits are $${(debit / 100).toFixed(2)} and credits are $${(credit / 100).toFixed(2)}.`);
  }
  if (lines.length >= 2 && debit === credit && !sawOpening) {
    problems.push(`Put the plug on account ${CODES.obe} (Opening balances) so the file balances.`);
  }
  if (problems.length) {
    for (const row of preview) {
      row.status = "error";
      for (const problem of problems) if (!row.messages.includes(problem)) row.messages.push(problem);
    }
    return { rows: preview, ready: [] as TrialRow[] };
  }
  return { rows: preview, ready: lines };
}

export function validateFormulas(rows: Record<string, string>[], existing: GoliveExisting) {
  const skus = new Set(existing.skus.map((sku) => sku.toUpperCase()));
  const have = new Set(existing.formulaSkus.map((sku) => sku.toUpperCase()));
  const groups = new Map<string, { lines: { ingredientSku: string; percent: number }[]; rows: number[]; errors: string[] }>();
  const preview: PreviewRow[] = [];
  for (const [index, row] of rows.entries()) {
    const messages: string[] = [];
    const sku = cleanCode(pick(row, "Finished SKU", "Product SKU"));
    const ingredient = cleanCode(pick(row, "Ingredient SKU", "Ingredient"));
    const percent = Number(pick(row, "Percent").replace("%", ""));
    if (!sku || !skus.has(sku)) messages.push(`Finished item ${sku || "(blank)"} is not on file.`);
    if (!ingredient || !skus.has(ingredient)) messages.push(`Ingredient ${ingredient || "(blank)"} is not on file.`);
    if (!(percent > 0)) messages.push("Percent must be greater than zero.");
    if (sku && have.has(sku)) messages.push(`${sku} already has a formula. This import will not add a second one.`);
    const group = groups.get(sku) ?? { lines: [], rows: [], errors: [] };
    group.rows.push(index + 2);
    if (messages.length) group.errors.push(...messages);
    else group.lines.push({ ingredientSku: ingredient, percent });
    groups.set(sku, group);
    preview.push({ rowNumber: index + 2, status: messages.length ? "error" : "ok", messages, summary: `${sku} · ${ingredient} · ${percent || "?"}%` });
  }
  const ready: FormulaGroup[] = [];
  for (const [sku, group] of groups) {
    const sum = group.lines.reduce((total, line) => total + line.percent, 0);
    const problems = [...group.errors];
    if (group.lines.length && Math.abs(sum - 100) >= 0.05) problems.push(`${sku} adds up to ${sum.toFixed(2)}%. A formula must add up to 100%.`);
    if (problems.length) {
      for (const rowNumber of group.rows) {
        const row = preview.find((item) => item.rowNumber === rowNumber);
        if (!row) continue;
        row.status = "error";
        for (const problem of problems) if (!row.messages.includes(problem)) row.messages.push(problem);
      }
    } else if (group.lines.length) ready.push({ sku, lines: group.lines });
  }
  return { rows: preview, ready };
}

export function validateBoms(rows: Record<string, string>[], existing: GoliveExisting) {
  const skus = new Set(existing.skus.map((sku) => sku.toUpperCase()));
  const have = new Set(existing.bomOutputs.map((sku) => sku.toUpperCase()));
  const groups = new Map<string, BomGroup & { rows: number[]; errors: string[] }>();
  const preview: PreviewRow[] = [];
  for (const [index, row] of rows.entries()) {
    const messages: string[] = [];
    const outputSku = cleanCode(pick(row, "Finished SKU", "Output SKU"));
    const bulkSku = cleanCode(pick(row, "Bulk SKU"));
    const materialSku = cleanCode(pick(row, "Packaging SKU", "Material SKU"));
    const qty = Number(pick(row, "Qty", "Quantity"));
    const basisRaw = pick(row, "Basis").toUpperCase();
    const basis = basisRaw === "CASE" || basisRaw === "PALLET" ? basisRaw : "UNIT";
    if (!outputSku || !skus.has(outputSku)) messages.push(`Finished item ${outputSku || "(blank)"} is not on file.`);
    if (bulkSku && !skus.has(bulkSku)) messages.push(`Bulk item ${bulkSku} is not on file.`);
    if (!materialSku || !skus.has(materialSku)) messages.push(`Packaging item ${materialSku || "(blank)"} is not on file.`);
    if (!(qty > 0)) messages.push("Qty must be greater than zero.");
    if (outputSku && have.has(outputSku)) messages.push(`${outputSku} already has a packaging list. This import will not add a second one.`);
    const group = groups.get(outputSku) ?? {
      outputSku, bulkSku, packageCode: pick(row, "Package") || "EACH",
      unitsPerCase: Number(pick(row, "Units per case")) || 1,
      casesPerPallet: Number(pick(row, "Cases per pallet")) || 1,
      lines: [], rows: [], errors: [],
    };
    if (bulkSku) group.bulkSku = bulkSku;
    group.rows.push(index + 2);
    if (messages.length) group.errors.push(...messages);
    else group.lines.push({ materialSku, qty, basis });
    groups.set(outputSku, group);
    preview.push({ rowNumber: index + 2, status: messages.length ? "error" : "ok", messages, summary: `${outputSku} · ${materialSku}` });
  }
  const ready: BomGroup[] = [];
  for (const group of groups.values()) {
    if (!group.bulkSku) group.errors.push(`${group.outputSku} needs a Bulk SKU.`);
    if (group.errors.length) {
      for (const rowNumber of group.rows) {
        const row = preview.find((item) => item.rowNumber === rowNumber);
        if (!row) continue;
        row.status = "error";
        for (const problem of group.errors) if (!row.messages.includes(problem)) row.messages.push(problem);
      }
    } else ready.push({ outputSku: group.outputSku, bulkSku: group.bulkSku, packageCode: group.packageCode, unitsPerCase: group.unitsPerCase, casesPerPallet: group.casesPerPallet, lines: group.lines });
  }
  return { rows: preview, ready };
}
