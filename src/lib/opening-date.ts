import { csvTable } from "./csv";
import { parseDateInput, parseLooseDate, todayInput } from "./dates";
import { detectGolive } from "./golive";
import { detectKind } from "./peachtree";

const MONTH: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function looksLikeHeader(line: string): boolean {
  const cells = csvTable(line)[0] ?? [];
  return Boolean(detectGolive(cells) || detectKind(cells));
}

/** Index of the column-header row. Lines above it are the report title. */
export function headerRowIndex(text: string): number {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim() && looksLikeHeader(line));
  return index < 0 ? 0 : index;
}

export function withoutPreamble(text: string): string {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const index = headerRowIndex(text);
  if (index <= 0) return text.replace(/^\uFEFF/, "");
  return lines.slice(index).join("\n");
}

export function parseAnyDate(text: string): string | null {
  const named = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})\b/i.exec(text);
  if (named) {
    const month = MONTH[named[1].toLowerCase()];
    const iso = `${named[3]}-${String(month).padStart(2, "0")}-${String(Number(named[2])).padStart(2, "0")}`;
    if (parseDateInput(iso)) return iso;
  }
  const us = /\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/.exec(text);
  if (us) {
    const parsed = parseLooseDate(us[1]);
    if (parsed) return parsed;
  }
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text);
  if (iso && parseDateInput(iso[1])) return iso[1];
  return null;
}

/** Date printed above the column headers, such as "As of October 31, 2026". */
export function dateInHeader(text: string): string | null {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const index = headerRowIndex(text);
  if (index <= 0) return null;
  const preamble = lines.slice(0, index).join("\n");
  const asOfLine = preamble.split(/\r?\n/).find((line) => /as\s+of/i.test(line));
  if (asOfLine) {
    const parsed = parseAnyDate(asOfLine);
    if (parsed) return parsed;
  }
  return parseAnyDate(preamble);
}

export function resolveOpeningDate(input: {
  asOf?: string | null;
  files?: string[];
  today?: string;
}): { ok: true; date: string } | { ok: false; error: string } {
  const today = input.today ?? todayInput();
  const typed = (input.asOf ?? "").trim();
  const header = typed ? null : (input.files ?? []).map(dateInHeader).find((date): date is string => Boolean(date)) ?? null;
  const raw = typed || header || "";
  if (!raw) return { ok: false, error: "Choose the as-of date for the opening trial balance and stock count." };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) && parseDateInput(raw) ? raw : parseLooseDate(raw) ?? parseAnyDate(raw);
  if (!date || !parseDateInput(date)) return { ok: false, error: "The as-of date must look like 2026-10-31." };
  if (date > today) return { ok: false, error: `The as-of date ${date} is in the future.` };
  return { ok: true, date };
}

export function suggestedAsOf(files: { kind: string; csv: string }[]): string {
  for (const file of files) {
    if (file.kind !== "stock" && file.kind !== "trial") continue;
    const found = dateInHeader(file.csv);
    if (found) return found;
  }
  return "";
}
