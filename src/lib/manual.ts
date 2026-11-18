export type ManualSection = {
  id: string;
  title: string;
  level: 2 | 3;
  body: string;
};

export type ManualDoc = {
  title: string;
  preamble: string;
  sections: ManualSection[];
};

export type ManualBlock =
  | { type: "p"; text: string }
  | { type: "ol"; items: string[] }
  | { type: "ul"; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] };

export const HOW_DO_I: { label: string; anchor: string }[] = [
  { label: "Run Amazon week", anchor: "amazon-week" },
  { label: "Invoice a direct order (S-)", anchor: "direct-orders" },
  { label: "Invoice an export (E-)", anchor: "exports" },
  { label: "Invoice a Walmart order (W-)", anchor: "walmart" },
  { label: "Receive a purchase order", anchor: "receive-a-po" },
  { label: "Pay a supplier bill", anchor: "pay-a-bill" },
  { label: "Record a customer payment", anchor: "record-a-payment" },
  { label: "Release Trevor's weekly plan", anchor: "release-trevor" },
  { label: "Check a low-stock alert", anchor: "low-stock" },
  { label: "Fix a wrong invoice", anchor: "wrong-invoice" },
];

export const REQUIRED_ANCHORS = [
  "who-does-what",
  "ffa",
  "chris",
  "trevor",
  "spike-bot",
  "chris-routines",
  "amazon-week",
  "direct-orders",
  "exports",
  "walmart",
  "receive-a-po",
  "pay-a-bill",
  "record-a-payment",
  "release-trevor",
  "low-stock",
  "product-rules",
  "package-sizes",
  "nsf",
  "invoice-numbers",
  "discounts",
  "terms",
  "bot-permissions",
  "rollout",
  "when-wrong",
  "deposit-mismatch",
  "negative-stock",
  "upload-error",
  "wrong-invoice",
  "who-to-call",
];

const HEADING = /^(#{2,3})\s+(.+)$/;
const ANCHOR = /\s*\{#([a-z0-9-]+)\}\s*$/;

export function parseManual(markdown: string): ManualDoc {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let title = "Operating manual";
  const preamble: string[] = [];
  const sections: ManualSection[] = [];
  let current: ManualSection | null = null;
  for (const line of lines) {
    if (line.startsWith("# ")) {
      title = line.slice(2).trim();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const anchor = ANCHOR.exec(heading[2]);
      const titleText = anchor ? heading[2].slice(0, anchor.index).trim() : heading[2].trim();
      current = {
        id: anchor?.[1] || slug(titleText),
        title: titleText,
        level: heading[1].length === 2 ? 2 : 3,
        body: "",
      };
      sections.push(current);
      continue;
    }
    if (current) current.body += `${line}\n`;
    else preamble.push(line);
  }
  return { title, preamble: preamble.join("\n").trim(), sections };
}

export function missingAnchors(markdown: string): string[] {
  const ids = new Set(parseManual(markdown).sections.map((section) => section.id));
  return REQUIRED_ANCHORS.filter((id) => !ids.has(id));
}

export function searchManual(sections: ManualSection[], query: string): { id: string; title: string; snippet: string }[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  const hits = [];
  for (const section of sections) {
    const hay = `${section.title}\n${section.body}`;
    const at = hay.toLowerCase().indexOf(needle);
    if (at < 0) continue;
    const start = Math.max(0, at - 50);
    hits.push({
      id: section.id,
      title: section.title,
      snippet: hay.slice(start, start + 180).replace(/\s+/g, " ").trim(),
    });
  }
  return hits;
}

export function sectionForScreen(pathname: string, tab: string): string {
  if (pathname.startsWith("/sales")) {
    if (tab === "week" || tab === "amazon") return "amazon-week";
    if (tab === "walmart") return "walmart";
    if (tab === "quotes" || tab === "orders" || tab === "invoices" || tab === "shipments" || tab === "customers") return "direct-orders";
    return "chris-routines";
  }
  if (pathname.startsWith("/products") || pathname.startsWith("/documents")) return "product-rules";
  if (pathname.startsWith("/inventory")) return tab === "coverage" ? "low-stock" : "release-trevor";
  if (pathname.startsWith("/purchasing")) return tab === "bills" ? "pay-a-bill" : "receive-a-po";
  if (pathname.startsWith("/money")) {
    if (tab === "bank") return "deposit-mismatch";
    if (tab === "payroll" || tab === "tax") return "bot-permissions";
    return "record-a-payment";
  }
  return "who-does-what";
}

export function screenLabel(pathname: string, params: { get(name: string): string | null }): { screen: string; recordRef: string } {
  const tab = params.get("tab") ?? "";
  const id = params.get("id") ?? "";
  const keep = new URLSearchParams();
  if (tab) keep.set("tab", tab);
  if (id) keep.set("id", id);
  const query = keep.toString();
  return { screen: query ? `${pathname}?${query}` : pathname || "/", recordRef: id };
}

export function blocksOf(body: string): ManualBlock[] {
  const lines = body.split("\n");
  const blocks: ManualBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        rows.push(lines[index].split("|").slice(1, -1).map((cell) => cell.trim()));
        index += 1;
      }
      const [headers, separator, ...rest] = rows;
      if (headers && separator?.every((cell) => /^:?-{3,}:?$/.test(cell))) {
        blocks.push({ type: "table", headers, rows: rest });
      }
      continue;
    }
    if (/^\d+\.\s+/.test(line.trim())) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }
    if (line.trim().startsWith("- ")) {
      const items: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith("- ")) {
        items.push(lines[index].trim().slice(2));
        index += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    const parts: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].trim().startsWith("|") &&
      !/^\d+\.\s+/.test(lines[index].trim()) &&
      !lines[index].trim().startsWith("- ")
    ) {
      parts.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: "p", text: parts.join(" ") });
  }
  return blocks;
}

/** The bot may read the manual. It may not change it, on any method. */
export function botManualResult(method: string): "read" | "refuse" {
  return method.toUpperCase() === "GET" ? "read" : "refuse";
}

export function mayEditManual(role: string): boolean {
  return role === "OWNER";
}

function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
}
