import type { CoverStatus } from "./coverage";

export type AlertItem = {
  id: string;
  sku: string;
  name: string;
  status: CoverStatus;
  onHand: number;
  unit: string;
  daysCover: number | null;
  openPoQty: number;
  suggestedQty: number;
  recipients: string[];
};

export type PriorAlert = { itemId: string; status: CoverStatus; emailedOn: string | null };

export type OutboundMail = { to: string[]; subject: string; text: string; itemIds: string[] };

export function stockAlerts(input: {
  asOf: string;
  digest: boolean;
  lastDigestOn: string | null;
  items: AlertItem[];
  previous: PriorAlert[];
}): { messages: OutboundMail[]; emailed: { itemId: string; status: CoverStatus }[] } {
  const previous = new Map(input.previous.map((row) => [row.itemId, row]));
  const actionable = input.items.filter((item) => item.status === "LOW" || item.status === "CRITICAL");
  if (input.digest) {
    if (input.lastDigestOn === input.asOf || actionable.length === 0) return { messages: [], emailed: [] };
    const byRecipient = new Map<string, AlertItem[]>();
    for (const item of actionable) {
      for (const recipient of item.recipients) {
        const list = byRecipient.get(recipient) ?? [];
        list.push(item);
        byRecipient.set(recipient, list);
      }
    }
    const messages: OutboundMail[] = [];
    for (const [to, items] of byRecipient) {
      messages.push({
        to: [to],
        subject: `SPIKE stock digest ${input.asOf}`,
        text: items.map((item) => lineFor(item)).join("\n"),
        itemIds: items.map((item) => item.id),
      });
    }
    return { messages, emailed: actionable.map((item) => ({ itemId: item.id, status: item.status })) };
  }
  const messages: OutboundMail[] = [];
  const emailed: { itemId: string; status: CoverStatus }[] = [];
  for (const item of actionable) {
    const prior = previous.get(item.id);
    if (prior && prior.status === item.status) continue;
    if (item.recipients.length === 0) continue;
    messages.push({
      to: item.recipients,
      subject: `${item.status === "CRITICAL" ? "Critical" : "Low"} stock: ${item.name}`,
      text: lineFor(item),
      itemIds: [item.id],
    });
    emailed.push({ itemId: item.id, status: item.status });
  }
  return { messages, emailed };
}

function lineFor(item: AlertItem): string {
  const cover = item.daysCover == null ? "no usage history" : `${item.daysCover} days of cover`;
  return `${item.sku} ${item.name}: ${item.status}. On hand ${item.onHand} ${item.unit} (${cover}). Open purchase orders ${item.openPoQty} ${item.unit}. Suggested order ${item.suggestedQty} ${item.unit}.`;
}
