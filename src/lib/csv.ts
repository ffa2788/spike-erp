export function csvTable(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return parseRows(clean);
}

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const table = csvTable(text).filter((row) => row.some((cell) => cell.trim() !== ""));
  if (table.length === 0) return { headers: [], rows: [] };
  const headers = table[0].map((cell) => cell.trim());
  const rows = table.slice(1).map((cols) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = (cols[index] ?? "").trim();
    });
    return record;
  });
  return { headers, rows };
}

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') inQuotes = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function normHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function pick(row: Record<string, string>, ...aliases: string[]): string {
  const entries = Object.entries(row);
  for (const alias of aliases) {
    const wanted = normHeader(alias);
    const found = entries.find(([key]) => normHeader(key) === wanted);
    if (found && found[1].trim()) return found[1].trim();
  }
  return "";
}
