export type AgingBucket = "current" | "1-30" | "31-60" | "61-90" | "over-90";

export function daysPastDue(due: string, asOf: string): number {
  const start = Date.parse(`${due}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  return Math.floor((end - start) / 86400000);
}

export function agingBucket(due: string, asOf: string): AgingBucket {
  const days = daysPastDue(due, asOf);
  if (days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "over-90";
}

export const AGING_LABEL: Record<AgingBucket, string> = {
  current: "Not due yet",
  "1-30": "1–30 days late",
  "31-60": "31–60 days late",
  "61-90": "61–90 days late",
  "over-90": "More than 90 days late",
};

export function summarizeAging(
  items: { name: string; balanceCents: number; due: string; id: string; number: string }[],
  asOf: string,
) {
  const buckets: Record<AgingBucket, number> = {
    current: 0,
    "1-30": 0,
    "31-60": 0,
    "61-90": 0,
    "over-90": 0,
  };
  const rows = items
    .filter((item) => item.balanceCents > 0)
    .map((item) => {
      const bucket = agingBucket(item.due, asOf);
      buckets[bucket] += item.balanceCents;
      return { ...item, bucket, days: Math.max(0, daysPastDue(item.due, asOf)) };
    })
    .sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
  const totalCents = rows.reduce((sum, row) => sum + row.balanceCents, 0);
  return { rows, buckets, totalCents };
}
