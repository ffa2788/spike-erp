export type PullItem = {
  name: string;
  qty: number;
  unit: string;
  onHand: number | null;
  short: number;
};

export type PlanJob = {
  dueOn: string;
  day: string;
  sku: string;
  name: string;
  packageLabel: string;
  qty: number;
  unit: string;
  fbaQty: number;
  keepQty: number;
  formulaVersion: number | null;
  daysCover: number | null;
  shortage: boolean;
  pulls: PullItem[];
};

export type ProductionPlan = {
  number: string;
  weekLabel: string;
  releasedLabel: string;
  jobs: PlanJob[];
  skipped: PlanJob[];
  batches: number;
  makeLabel: string;
  unitsToPack: number;
  shortCount: number;
  formulaPicks: PullItem[];
  packagingPicks: PullItem[];
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const PACKAGING = /jug|cap|label|carton|divider|tape|pallet|wrap|corner|bag|jar/i;

export function planDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

export function dayName(iso: string): string {
  return DAYS[new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay()] ?? "";
}

export function displayName(name: string): string {
  return name.replace(/^Example\s+/i, "").trim();
}

export function isPackaging(name: string): boolean {
  return PACKAGING.test(displayName(name));
}

function roundQty(qty: number): number {
  return Math.round(qty * 100) / 100;
}

export function wholeUnits(qty: number): number {
  if (!(qty > 0)) return 0;
  return Math.ceil(qty - 1e-9);
}

export function parsePulls(raw: string): PullItem[] {
  const text = raw.trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text) as PullItem[];
      if (Array.isArray(parsed)) {
        return parsed.map((item) => ({
          name: displayName(String(item.name ?? "")),
          qty: Number(item.qty) || 0,
          unit: String(item.unit ?? ""),
          onHand: item.onHand == null ? null : Number(item.onHand),
          short: Number(item.short) || 0,
        }));
      }
    } catch {
      /* older plain-text lists fall through */
    }
  }
  return text.split("\n").flatMap((line) => {
    const match = /^(.+?): ([0-9.]+) ([^(\n]+?)(?: \(short ([0-9.]+)\))?$/.exec(line.trim());
    if (!match) return [];
    const qty = Number(match[2]);
    const short = match[4] ? Number(match[4]) : 0;
    return [{
      name: displayName(match[1]),
      qty,
      unit: match[3].trim(),
      onHand: short > 0 ? roundQty(Math.max(0, qty - short)) : null,
      short,
    }];
  });
}

function gallonsOf(label: string, qty: number): number | null {
  const match = /([0-9.]+)\s*gal/i.exec(label);
  if (!match || !(qty > 0)) return null;
  return roundQty(Number(match[1]) * qty);
}

function qtyText(qty: number, unit: string): string {
  if (!(qty > 0)) return "—";
  const shown = Number.isInteger(qty) ? String(qty) : String(roundQty(qty));
  return unit ? `${shown} ${unit}` : shown;
}

function consolidate(items: PullItem[], packaging: boolean): PullItem[] {
  const map = new Map<string, PullItem>();
  for (const item of items) {
    if (isPackaging(item.name) !== packaging) continue;
    const qty = packaging ? wholeUnits(item.qty) : roundQty(item.qty);
    const short = packaging ? wholeUnits(item.short) : roundQty(item.short);
    const key = `${item.name}|${item.unit}`;
    const current = map.get(key);
    if (!current) {
      map.set(key, { ...item, name: displayName(item.name), qty, short, onHand: item.onHand });
      continue;
    }
    current.qty = roundQty(current.qty + qty);
    current.short = roundQty(current.short + short);
    if (item.onHand != null) current.onHand = (current.onHand ?? 0) + item.onHand;
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function buildPlan(input: {
  number: string;
  weekOf: string;
  releasedOn: string;
  releasedBy: string;
  lines: {
    dueOn: string;
    sku: string;
    name: string;
    packageLabel: string;
    qty: number;
    fbaQty: number;
    unit: string;
    formulaVersion: number | null;
    daysCover: number | null;
    shortage: boolean;
    materials: string;
  }[];
}): ProductionPlan {
  const jobsAll: PlanJob[] = input.lines.map((line) => {
    const qty = Number(line.qty) || 0;
    const fbaQty = Number(line.fbaQty) || 0;
    return {
      dueOn: line.dueOn.slice(0, 10),
      day: dayName(line.dueOn),
      sku: line.sku,
      name: line.name,
      packageLabel: line.packageLabel,
      qty,
      unit: line.unit,
      fbaQty,
      keepQty: Math.max(0, roundQty(qty - fbaQty)),
      formulaVersion: line.formulaVersion,
      daysCover: line.daysCover,
      shortage: line.shortage,
      pulls: parsePulls(line.materials),
    };
  }).sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.sku.localeCompare(b.sku));
  const jobs = jobsAll.filter((job) => job.qty > 0);
  const skipped = jobsAll.filter((job) => !(job.qty > 0));
  const pulls = jobs.flatMap((job) => job.pulls);
  const gallons = jobs.reduce((sum, job) => sum + (gallonsOf(job.packageLabel, job.qty) ?? 0), 0);
  const pounds = jobs.filter((job) => job.unit === "lb").reduce((sum, job) => sum + job.qty, 0);
  const make = [
    gallons > 0 ? `${roundQty(gallons)} gal` : "",
    pounds > 0 ? `${roundQty(pounds)} lb` : "",
  ].filter(Boolean);
  const packagingPicks = consolidate(pulls, true);
  const formulaPicks = consolidate(pulls, false);
  const shortCount = [...packagingPicks, ...formulaPicks].filter((item) => item.short > 0).length;
  return {
    number: input.number,
    weekLabel: planDate(input.weekOf),
    releasedLabel: [input.releasedBy, planDate(input.releasedOn)].filter(Boolean).join(" · "),
    jobs,
    skipped,
    batches: jobs.length,
    makeLabel: make.join(" · ") || "—",
    unitsToPack: jobs.reduce((sum, job) => sum + job.qty, 0),
    shortCount,
    formulaPicks,
    packagingPicks,
  };
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function pickRows(items: PullItem[]): string {
  if (items.length === 0) return `<tr><td colspan="5" style="padding:8px 10px;color:#64748b;">None.</td></tr>`;
  return items.map((item) => {
    const short = item.short > 0;
    return `<tr>
      <td style="padding:3px 8px;border-bottom:1px solid #e2e8f0;">${esc(item.name)}</td>
      <td style="padding:3px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${qtyText(item.qty, "")}</td>
      <td style="padding:3px 8px;border-bottom:1px solid #e2e8f0;">${esc(item.unit)}</td>
      <td style="padding:3px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${item.onHand == null ? "—" : qtyText(item.onHand, "")}</td>
      <td style="padding:3px 8px;border-bottom:1px solid #e2e8f0;text-align:right;${short ? "color:#c53030;font-weight:700;" : ""}">${short ? qtyText(item.short, "") : "—"}</td>
    </tr>`;
  }).join("");
}

export function planDocumentHtml(plan: ProductionPlan, logoSrc: string): string {
  const jobsByDay = new Map<string, PlanJob[]>();
  for (const job of plan.jobs) {
    const list = jobsByDay.get(job.dueOn) ?? [];
    list.push(job);
    jobsByDay.set(job.dueOn, list);
  }
  let jobRows = "";
  for (const [due, jobs] of jobsByDay) {
    jobRows += `<tr><td colspan="8" style="background:#0f2b46;color:#fff;padding:6px 10px;font-weight:700;">${esc(dayName(due))} ${esc(planDate(due))}</td></tr>`;
    jobs.forEach((job, index) => {
      const bg = index % 2 === 0 ? "#ffffff" : "#f0f9ff";
      const chip = job.shortage
        ? `<span style="display:inline-block;background:#fef2f2;color:#c53030;border:1px solid #fecaca;border-radius:999px;padding:2px 8px;font-size:12px;font-weight:700;white-space:nowrap;">Material short</span>`
        : `<span style="display:inline-block;background:#dcfce7;color:#276749;border:1px solid #bbf7d0;border-radius:999px;padding:2px 8px;font-size:12px;font-weight:700;white-space:nowrap;">Ready</span>`;
      jobRows += `<tr style="background:${bg};">
        <td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;white-space:nowrap;">${esc(job.day)}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;"><strong>${esc(job.name)}</strong><br><span style="color:#64748b;font-size:12px;">${esc(job.sku)}</span></td>
        <td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;">${esc(job.packageLabel)}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${qtyText(job.qty, job.unit)}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${qtyText(job.fbaQty, job.unit)}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${qtyText(job.keepQty, job.unit)}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;text-align:right;">${job.formulaVersion ?? "—"}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;">${chip}</td>
      </tr>`;
    });
  }
  if (!jobRows) jobRows = `<tr><td colspan="8" style="padding:12px;">No batches this week.</td></tr>`;
  const skipped = plan.skipped.length === 0 ? "" : `
    <h2 style="font-size:16px;font-weight:700;margin:18px 0 8px;">Not needed this week</h2>
    <table style="width:100%;border-collapse:collapse;font-size:13px;color:#64748b;">
      ${plan.skipped.map((job) => `<tr><td style="padding:3px 8px;border-bottom:1px solid #e2e8f0;"><strong>${esc(job.name)}</strong> ${esc(job.sku)}</td><td style="padding:3px 8px;border-bottom:1px solid #e2e8f0;">No batch needed, ${job.daysCover == null ? "cover not calculated" : `${job.daysCover} days of cover`}.</td></tr>`).join("")}
    </table>`;
  const materialBlocks = plan.jobs.map((job) => `
    <h3 style="font-size:13px;margin:10px 0 4px;">${esc(job.name)} <span style="color:#64748b;font-weight:400;">${esc(job.sku)}</span></h3>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead><tr style="background:#e0f2fe;">
        <th style="text-align:left;padding:6px 10px;">Material</th>
        <th style="text-align:right;padding:6px 10px;">Qty</th>
        <th style="text-align:left;padding:6px 10px;">Unit</th>
        <th style="text-align:right;padding:6px 10px;">On hand</th>
        <th style="text-align:right;padding:6px 10px;">Short</th>
      </tr></thead>
      <tbody>${pickRows(job.pulls.filter((item) => !isPackaging(item.name)))}</tbody>
    </table>`).join("");
  return `<article class="plan" style="font-family:Helvetica,Arial,sans-serif;color:#0f2b46;background:#fff;">
    <table style="width:100%;border-collapse:collapse;background:#0f2b46;color:#fff;">
      <tr>
        <td style="padding:8px 14px;width:180px;background:#fff;"><img src="${esc(logoSrc)}" alt="SPER Chemical" style="height:44px;width:auto;"></td>
        <td style="padding:8px 14px;text-align:right;">
          <div style="font-size:20px;font-weight:700;">Production Plan, Week of ${esc(plan.weekLabel)}</div>
          <div style="font-size:14px;margin-top:4px;">${esc(plan.number)}${plan.releasedLabel ? ` · Released ${esc(plan.releasedLabel)}` : ""}</div>
        </td>
      </tr>
    </table>
    <table style="width:100%;border-collapse:collapse;margin:8px 0;background:#f0f9ff;">
      <tr>
        ${[
          ["Batches this week", String(plan.batches)],
          ["To make", plan.makeLabel],
          ["Units to pack", String(plan.unitsToPack)],
          ["Items short", String(plan.shortCount)],
        ].map(([label, value]) => `<td style="padding:6px 10px;border:1px solid #bae6fd;width:25%;"><div style="font-size:11px;color:#1e4d7b;text-transform:uppercase;">${label}</div><div style="font-size:18px;font-weight:700;">${esc(value)}</div></td>`).join("")}
      </tr>
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="background:#e0f2fe;">
        <th style="text-align:left;padding:5px 8px;white-space:nowrap;">Day</th>
        <th style="text-align:left;padding:5px 8px;white-space:nowrap;">Product</th>
        <th style="text-align:left;padding:5px 8px;white-space:nowrap;">Presentation</th>
        <th style="text-align:right;padding:5px 8px;white-space:nowrap;">Qty to make</th>
        <th style="text-align:right;padding:5px 8px;white-space:nowrap;">Ship to FBA</th>
        <th style="text-align:right;padding:5px 8px;white-space:nowrap;">Keep in supermarket</th>
        <th style="text-align:right;padding:5px 8px;white-space:nowrap;">Formula ver.</th>
        <th style="text-align:left;padding:5px 8px;white-space:nowrap;">Status</th>
      </tr></thead>
      <tbody>${jobRows}</tbody>
    </table>
    <table style="width:100%;border-collapse:collapse;margin-top:14px;">
      <tr>
        <td style="width:50%;vertical-align:top;padding-right:10px;">
          <h2 style="font-size:16px;margin:0 0 4px;">Materials to pull</h2>
          ${materialBlocks || "<p>No formula materials.</p>"}
        </td>
        <td style="width:50%;vertical-align:top;padding-left:10px;">
          <h2 style="font-size:16px;margin:0 0 4px;">Packaging pick list</h2>
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead><tr style="background:#e0f2fe;">
              <th style="text-align:left;padding:6px 10px;">Material</th>
              <th style="text-align:right;padding:6px 10px;">Qty</th>
              <th style="text-align:left;padding:6px 10px;">Unit</th>
              <th style="text-align:right;padding:6px 10px;">On hand</th>
              <th style="text-align:right;padding:6px 10px;">Short</th>
            </tr></thead>
            <tbody>${pickRows(plan.packagingPicks)}</tbody>
          </table>
        </td>
      </tr>
    </table>
    ${skipped}
    <div style="margin-top:8px;border:1px solid #cbd5e1;padding:6px 10px;background:#f8fafc;">
      <strong>Notes.</strong> Pull lot numbers when the batch starts. Do not start a batch when a material is short.
    </div>
    <table style="width:100%;margin-top:6px;font-size:13px;page-break-before:avoid;">
      <tr>
        <td style="padding:8px 0;">Batched by ____________________</td>
        <td>Date ____________________</td>
        <td>Checked by ____________________</td>
      </tr>
    </table>
  </article>`;
}

export function planEmailHtml(plan: ProductionPlan): string {
  const rows = plan.jobs.map((job) => `<tr>
    <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${esc(job.day)}</td>
    <td style="padding:8px;border-bottom:1px solid #e2e8f0;"><strong>${esc(job.name)}</strong><br><span style="color:#64748b;font-size:12px;">${esc(job.sku)} · ${esc(job.packageLabel)}</span></td>
    <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">${qtyText(job.qty, job.unit)}</td>
    <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">${qtyText(job.fbaQty, job.unit)}</td>
    <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${job.shortage ? `<span style="color:#c53030;font-weight:700;">Material short</span>` : `<span style="color:#276749;font-weight:700;">Ready</span>`}</td>
  </tr>`).join("");
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:0;background:#f0f9ff;font-family:Helvetica,Arial,sans-serif;color:#0f2b46;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9ff;"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;table-layout:fixed;">
    <tr><td style="background:#0f2b46;color:#ffffff;padding:16px 18px;">
      <div style="font-size:12px;letter-spacing:0.08em;">SPER CHEMICAL</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px;">Production Plan, Week of ${esc(plan.weekLabel)}</div>
      <div style="font-size:14px;margin-top:4px;">${esc(plan.number)}</div>
    </td></tr>
    <tr><td style="padding:12px 18px;background:#e0f2fe;">
      ${esc(String(plan.batches))} batches · ${esc(plan.makeLabel)} to make · ${esc(String(plan.unitsToPack))} units to pack · ${esc(String(plan.shortCount))} items short
    </td></tr>
    <tr><td style="padding:8px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">
        <tr style="background:#f0f9ff;">
          <th align="left" width="18%" style="padding:8px;">Day</th>
          <th align="left" width="34%" style="padding:8px;">Product</th>
          <th align="right" width="16%" style="padding:8px;">Make</th>
          <th align="right" width="12%" style="padding:8px;">FBA</th>
          <th align="left" width="20%" style="padding:8px;">Status</th>
        </tr>
        ${rows || `<tr><td colspan="5" style="padding:12px;">No batches this week.</td></tr>`}
      </table>
      <p style="font-size:13px;color:#1e4d7b;">The attached PDF is the sheet to print. Do not start a batch when a material is short.</p>
    </td></tr>
  </table>
  </td></tr></table></body></html>`;
}

export function planPlainText(plan: ProductionPlan): string {
  const lines = [
    `SPER CHEMICAL`,
    `Production Plan, Week of ${plan.weekLabel}`,
    plan.number,
    "",
    `Batches this week: ${plan.batches}`,
    `To make: ${plan.makeLabel}`,
    `Units to pack: ${plan.unitsToPack}`,
    `Items short: ${plan.shortCount}`,
    "",
    "JOBS",
  ];
  for (const job of plan.jobs) {
    lines.push(`${job.day}  ${job.name} (${job.sku})  ${job.packageLabel}`);
    lines.push(`  Make ${qtyText(job.qty, job.unit)}   FBA ${qtyText(job.fbaQty, job.unit)}   Keep ${qtyText(job.keepQty, job.unit)}   ${job.shortage ? "Material short" : "Ready"}`);
    for (const item of job.pulls.filter((pull) => !isPackaging(pull.name))) {
      lines.push(`  Material  ${item.name}  ${qtyText(item.qty, item.unit)}${item.short > 0 ? `  short ${qtyText(item.short, item.unit)}` : ""}`);
    }
  }
  lines.push("", "PACKAGING PICK LIST");
  for (const item of plan.packagingPicks) {
    lines.push(`  ${item.name}  ${qtyText(item.qty, item.unit)}${item.short > 0 ? `  short ${qtyText(item.short, item.unit)}` : ""}`);
  }
  if (plan.skipped.length) {
    lines.push("", "NOT NEEDED THIS WEEK");
    for (const job of plan.skipped) lines.push(`  ${job.name}: no batch needed, ${job.daysCover ?? "—"} days of cover`);
  }
  lines.push("", "Pull lot numbers when the batch starts. Do not start a batch when a material is short.");
  return lines.join("\n");
}

export function workListTable(input: { number: string; weekOf: string; lines: { dueOn: string; sku: string; name: string; packageLabel: string; qty: string; fbaQty: string; unit: string; materials: string; shortage: boolean; formulaVersion?: number | null; daysCover?: number | null }[] }): { subject: string; text: string; html: string } {
  const plan = buildPlan({
    number: input.number,
    weekOf: input.weekOf,
    releasedOn: input.weekOf,
    releasedBy: "",
    lines: input.lines.map((line) => ({
      dueOn: line.dueOn,
      sku: line.sku,
      name: line.name,
      packageLabel: line.packageLabel,
      qty: Number(line.qty) || 0,
      fbaQty: Number(line.fbaQty) || 0,
      unit: line.unit,
      formulaVersion: line.formulaVersion ?? null,
      daysCover: line.daysCover ?? null,
      shortage: line.shortage,
      materials: line.materials,
    })),
  });
  return { subject: `Work list ${plan.number} for Trevor`, text: planPlainText(plan), html: planEmailHtml(plan) };
}
