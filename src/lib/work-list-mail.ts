export type WorkListLine = {
  dueOn: string;
  sku: string;
  name: string;
  packageLabel: string;
  qty: string;
  fbaQty: string;
  unit: string;
  materials: string;
  shortage: boolean;
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dayOf(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return DAYS[date.getUTCDay()] ?? "";
}

export function workListTable(input: { number: string; weekOf: string; lines: WorkListLine[] }): { subject: string; text: string } {
  const subject = `Work list ${input.number} for Trevor`;
  const header = ["Day", "SKU", "Package", "Make", "Ship to FBA", "Materials"].join("\t");
  const rows = input.lines.map((line) => [
    dayOf(line.dueOn),
    line.sku,
    line.packageLabel,
    `${line.qty} ${line.unit}`,
    `${line.fbaQty} ${line.unit}`,
    line.shortage ? `${line.materials} SHORT` : line.materials || "—",
  ].join("\t"));
  const text = [
    subject,
    `Week of ${input.weekOf}.`,
    "Print the attached PDF and make these items. This note is the same list in a table.",
    "",
    header,
    ...rows,
  ].join("\n");
  return { subject, text };
}

function pdfEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** A one-page Helvetica PDF. No extra font file. */
export function workListPdf(input: { number: string; weekOf: string; lines: WorkListLine[] }): Uint8Array {
  const rows = [
    `Work list ${input.number} for Trevor`,
    `Week of ${input.weekOf}`,
    "",
    "Day          SKU            Package        Make           Ship to FBA",
    ...input.lines.map((line) => `${dayOf(line.dueOn).padEnd(12)} ${line.sku.padEnd(14)} ${line.packageLabel.padEnd(14)} ${`${line.qty} ${line.unit}`.padEnd(14)} ${line.fbaQty} ${line.unit}`),
    "",
    "Materials",
    ...input.lines.flatMap((line) => [`${line.sku}: ${line.materials || "none"}${line.shortage ? " SHORT" : ""}`]),
  ].slice(0, 42);
  const commands = ["BT", "/F1 11 Tf", "48 750 Td", "16 TL"];
  rows.forEach((row, index) => {
    const text = `(${pdfEscape(row)}) Tj`;
    commands.push(index === 0 ? text : `T* ${text}`);
  });
  commands.push("ET");
  const stream = commands.join("\n");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
    `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj\n`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(body.length);
    body += object;
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i += 1) body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(body);
}
