import { parseLooseDate } from "./dates";
import { cleanCode, nameKey, validCode } from "./names";
import { parseMoneyToCents } from "./pricing";
import { normHeader, pick } from "./csv";

export type ImportKind = "customers" | "vendors" | "items" | "accounts" | "journal";

export type PreviewRow = {
  rowNumber: number;
  status: "ok" | "warning" | "error";
  messages: string[];
  summary: string;
};

export type CustomerImport = {
  code: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  billStreet: string;
  billCity: string;
  billState: string;
  billZip: string;
  paymentTermsDays: number;
};

export type ItemImport = {
  sku: string;
  name: string;
  kind: "RAW" | "FINISHED" | "UTILITY";
  unit: string;
  standardCost: number;
  listPrice: number | null;
  priceStatus: "UNSET" | "PLACEHOLDER" | "CONFIRMED";
  sellable: boolean;
  trackInventory: boolean;
};

export type AccountImport = {
  code: string;
  name: string;
  type: "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "COGS" | "EXPENSE";
};

export type JournalImport = {
  reference: string;
  date: string;
  memo: string;
  lines: { accountCode: string; debitCents: number; creditCents: number; memo: string }[];
};

export type ExistingKeys = {
  partyCodes: string[];
  partyNames: string[];
  skus: string[];
  productNames: string[];
  accountCodes: string[];
};

export function detectKind(headers: string[]): ImportKind | null {
  const names = headers.map(normHeader);
  const has = (...keys: string[]) => keys.some((key) => names.includes(key));
  if (has("debit", "credit", "amount") && has("accountid", "accountnumber", "glaccount")) return "journal";
  if (has("vendorid", "vendorname")) return "vendors";
  if (has("customerid", "customername")) return "customers";
  if (has("itemid", "itemdescription")) return "items";
  if (has("accountid", "accountnumber") && has("accountdescription", "accounttype", "description")) return "accounts";
  return null;
}

function stateOk(value: string): boolean {
  return value === "" || /^[A-Z]{2}$/.test(value);
}

export function validateCustomers(
  rows: Record<string, string>[],
  existing: ExistingKeys,
  asVendor: boolean,
): { rows: (PreviewRow & { data: CustomerImport | null })[]; ready: CustomerImport[] } {
  const seenCodes = new Set(existing.partyCodes.map((code) => code.toUpperCase()));
  const seenNames = new Set(existing.partyNames);
  const result: (PreviewRow & { data: CustomerImport | null })[] = [];
  for (const [index, row] of rows.entries()) {
    const messages: string[] = [];
    const code = cleanCode(pick(row, "Customer ID", "Vendor ID", "ID", "Cust ID"));
    const name = pick(row, "Customer Name", "Vendor Name", "Name", "Company");
    const billState = pick(row, "Bill to State", "State").toUpperCase();
    if (!code) messages.push("Every row needs an ID. A blank ID is how duplicate customers get into the books.");
    else if (!validCode(code)) messages.push(`ID “${code}” should use letters, numbers, and hyphens only.`);
    else if (seenCodes.has(code)) messages.push(`ID ${code} is already used. Open that record instead of importing a second one.`);
    if (!name) messages.push("Every row needs a name.");
    else if (seenNames.has(nameKey(name))) {
      messages.push(`“${name}” matches a name already on file. SPIKE keeps one record per name.`);
    }
    if (!stateOk(billState)) messages.push("State must be two letters, such as FL.");
    const email = pick(row, "E-mail", "Email");
    if (email && !email.includes("@")) messages.push("That email address does not look usable.");
    const status = messages.length ? "error" : "ok";
    const data: CustomerImport | null =
      status === "error"
        ? null
        : {
            code,
            name,
            contactName: pick(row, "Contact", "Bill to Contact"),
            email,
            phone: pick(row, "Telephone 1", "Phone", "Telephone"),
            billStreet: pick(row, "Bill to Address-Line One", "Address", "Bill to Address 1"),
            billCity: pick(row, "Bill to City", "City"),
            billState,
            billZip: pick(row, "Bill to Zip", "Zip", "Postal Code"),
            paymentTermsDays: 30,
          };
    if (data) {
      seenCodes.add(code);
      seenNames.add(nameKey(name));
    }
    result.push({
      rowNumber: index + 2,
      status,
      messages,
      summary: name || code || "(blank row)",
      data,
    });
  }
  return { rows: result, ready: result.flatMap((row) => (row.data ? [row.data] : [])) };
}

function itemKind(row: Record<string, string>, hasPrice: boolean): "RAW" | "FINISHED" | "UTILITY" {
  const explicit = pick(row, "Kind", "Item Kind", "Type").toLowerCase();
  if (["raw", "raw material", "ingredient"].includes(explicit)) return "RAW";
  if (["finished", "finished good", "product"].includes(explicit)) return "FINISHED";
  if (["utility", "service", "non-stock", "nonstock", "labor"].includes(explicit)) return "UTILITY";
  const klass = pick(row, "Item Class", "Class").toLowerCase();
  if (["service", "labor", "non-stock item", "non-stock", "charge item", "description"].includes(klass)) {
    return "UTILITY";
  }
  return hasPrice ? "FINISHED" : "RAW";
}

export function validateItems(
  rows: Record<string, string>[],
  existing: ExistingKeys,
): { rows: (PreviewRow & { data: ItemImport | null })[]; ready: ItemImport[] } {
  const seenSku = new Set(existing.skus.map((sku) => sku.toUpperCase()));
  const seenNames = new Set(existing.productNames);
  const result: (PreviewRow & { data: ItemImport | null })[] = [];
  for (const [index, row] of rows.entries()) {
    const messages: string[] = [];
    const warnings: string[] = [];
    const sku = cleanCode(pick(row, "Item ID", "ItemID", "SKU"));
    const name = pick(row, "Item Description", "Description", "Name");
    const priceRaw = pick(row, "Sales Price", "Price", "Unit Price");
    const costRaw = pick(row, "Cost", "Unit Cost", "Last Unit Cost");
    const priceCents = priceRaw ? parseMoneyToCents(priceRaw) : 0;
    const costCents = costRaw ? parseMoneyToCents(costRaw) : 0;
    if (!sku) messages.push("Every item needs an item ID. SPIKE does not keep a second, uncoded copy.");
    else if (!validCode(sku)) messages.push(`Item ID “${sku}” should use letters, numbers, and hyphens only.`);
    else if (seenSku.has(sku)) messages.push(`Item ID ${sku} is already on file.`);
    if (!name) messages.push("Every item needs a description.");
    else if (seenNames.has(nameKey(name))) messages.push(`“${name}” matches a product already on file.`);
    if (priceRaw && priceCents == null) messages.push("Sales price is not a number.");
    if (costRaw && costCents == null) messages.push("Cost is not a number.");
    if (priceCents === 100) {
      messages.push("Sales price is $1.00. SPIKE will not import a placeholder price. Put the real price in the file, or leave Sales Price blank.");
    }
    if (priceCents != null && priceCents < 0) messages.push("Sales price cannot be negative.");
    if (costCents != null && costCents < 0) messages.push("Cost cannot be negative.");
    const kind = itemKind(row, (priceCents ?? 0) > 0 && priceCents !== 100);
    if ((costCents ?? 0) === 0 && kind !== "UTILITY") {
      warnings.push("No cost yet. A recipe that uses this item stays blocked until you enter a real cost.");
    }
    if ((priceCents ?? 0) === 0 && kind === "FINISHED") {
      warnings.push("No selling price yet. This item can be saved, but it cannot be sold until you set a real price.");
    }
    const status = messages.length ? "error" : warnings.length ? "warning" : "ok";
    const listPrice = priceCents && priceCents > 0 && priceCents !== 100 ? priceCents / 100 : null;
    const data: ItemImport | null =
      status === "error"
        ? null
        : {
            sku,
            name,
            kind,
            unit: pick(row, "Unit", "Stocking U/M", "UOM") || "lb",
            standardCost: Math.max(0, costCents ?? 0) / 100,
            listPrice,
            priceStatus: listPrice ? "CONFIRMED" : "UNSET",
            sellable: listPrice != null && kind !== "UTILITY",
            trackInventory: kind !== "UTILITY",
          };
    if (data) {
      seenSku.add(sku);
      seenNames.add(nameKey(name));
    }
    result.push({
      rowNumber: index + 2,
      status,
      messages: [...messages, ...warnings],
      summary: name || sku || "(blank row)",
      data,
    });
  }
  return { rows: result, ready: result.flatMap((row) => (row.data ? [row.data] : [])) };
}

const TYPE_MAP: Record<string, AccountImport["type"]> = {
  cash: "ASSET",
  bank: "ASSET",
  accountsreceivable: "ASSET",
  accountreceivable: "ASSET",
  inventory: "ASSET",
  othercurrentassets: "ASSET",
  fixedassets: "ASSET",
  asset: "ASSET",
  accountspayable: "LIABILITY",
  accountpayable: "LIABILITY",
  othercurrentliabilities: "LIABILITY",
  longtermliabilities: "LIABILITY",
  liability: "LIABILITY",
  equity: "EQUITY",
  capital: "EQUITY",
  retainedearnings: "EQUITY",
  income: "INCOME",
  revenue: "INCOME",
  costofsales: "COGS",
  costofgoodssold: "COGS",
  expense: "EXPENSE",
  expenses: "EXPENSE",
};

export function validateAccounts(
  rows: Record<string, string>[],
  existing: ExistingKeys,
): { rows: (PreviewRow & { data: AccountImport | null })[]; ready: AccountImport[] } {
  const seen = new Set(existing.accountCodes);
  const result: (PreviewRow & { data: AccountImport | null })[] = [];
  for (const [index, row] of rows.entries()) {
    const messages: string[] = [];
    const code = cleanCode(pick(row, "Account ID", "Account Number"));
    const name = pick(row, "Account Description", "Description", "Name");
    const typeRaw = normHeader(pick(row, "Account Type", "Type"));
    const type = TYPE_MAP[typeRaw];
    if (!code) messages.push("Every account needs an account ID.");
    else if (seen.has(code)) messages.push(`Account ${code} is already on the chart.`);
    if (!name) messages.push("Every account needs a description.");
    if (!type) messages.push(`Account type “${pick(row, "Account Type", "Type") || "(blank)"}” is not one SPIKE understands.`);
    const data = messages.length || !type ? null : { code, name, type };
    if (data) seen.add(code);
    result.push({
      rowNumber: index + 2,
      status: messages.length ? "error" : "ok",
      messages,
      summary: name || code || "(blank row)",
      data,
    });
  }
  return { rows: result, ready: result.flatMap((row) => (row.data ? [row.data] : [])) };
}

export function validateJournal(
  rows: Record<string, string>[],
  existing: ExistingKeys,
): { rows: PreviewRow[]; ready: JournalImport[] } {
  const groups = new Map<string, { date: string; memo: string; lines: JournalImport["lines"]; rowNumbers: number[]; errors: string[] }>();
  const preview: PreviewRow[] = [];
  for (const [index, row] of rows.entries()) {
    const messages: string[] = [];
    const accountCode = cleanCode(pick(row, "Account ID", "Account Number", "GL Account"));
    const reference = pick(row, "Reference", "Ref", "Journal") || "(no reference)";
    const date = parseLooseDate(pick(row, "Date"));
    const memo = pick(row, "Description", "Memo") || reference;
    const debitRaw = pick(row, "Debit");
    const creditRaw = pick(row, "Credit");
    let debit = debitRaw ? parseMoneyToCents(debitRaw) : 0;
    let credit = creditRaw ? parseMoneyToCents(creditRaw) : 0;
    if (!debitRaw && !creditRaw) {
      const amount = parseMoneyToCents(pick(row, "Amount"));
      if (amount == null) messages.push("Amount is not a number.");
      else if (amount >= 0) debit = amount;
      else credit = -amount;
    }
    if (debit == null || credit == null) messages.push("Debit or credit is not a number.");
    if (!accountCode) messages.push("Every line needs an account ID.");
    else if (!existing.accountCodes.includes(accountCode)) messages.push(`Account ${accountCode} is not on the chart.`);
    if (!date) messages.push("Date must look like 2026-11-14 or 11/14/2026.");
    if ((debit ?? 0) > 0 && (credit ?? 0) > 0) messages.push("Use a debit or a credit, not both.");
    if ((debit ?? 0) === 0 && (credit ?? 0) === 0) messages.push("Enter a debit or a credit.");
    const key = `${reference}::${date ?? ""}`;
    const group = groups.get(key) ?? { date: date ?? "", memo, lines: [], rowNumbers: [], errors: [] };
    group.rowNumbers.push(index + 2);
    if (messages.length) group.errors.push(...messages.map((message) => `Row ${index + 2}: ${message}`));
    else if (date && debit != null && credit != null) {
      group.lines.push({ accountCode, debitCents: debit, creditCents: credit, memo });
    }
    groups.set(key, group);
    preview.push({
      rowNumber: index + 2,
      status: messages.length ? "error" : "ok",
      messages,
      summary: `${reference} · ${accountCode || "no account"}`,
    });
  }

  const ready: JournalImport[] = [];
  for (const [key, group] of groups) {
    const reference = key.split("::")[0];
    const debit = group.lines.reduce((sum, line) => sum + line.debitCents, 0);
    const credit = group.lines.reduce((sum, line) => sum + line.creditCents, 0);
    const problems = [...group.errors];
    if (group.lines.length < 2) problems.push(`Reference ${reference} needs at least two good lines.`);
    if (debit !== credit) {
      problems.push(
        `Reference ${reference} does not balance. Debits are $${(debit / 100).toFixed(2)} and credits are $${(credit / 100).toFixed(2)}.`,
      );
    }
    if (problems.length) {
      for (const rowNumber of group.rowNumbers) {
        const row = preview.find((item) => item.rowNumber === rowNumber);
        if (!row) continue;
        row.status = "error";
        for (const problem of problems) {
          if (!row.messages.includes(problem)) row.messages.push(problem);
        }
      }
    } else {
      ready.push({ reference, date: group.date, memo: group.memo, lines: group.lines });
    }
  }
  return { rows: preview, ready };
}
