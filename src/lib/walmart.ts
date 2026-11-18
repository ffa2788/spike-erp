export const WALMART_ENV_KEYS = ["WALMART_CLIENT_ID", "WALMART_CLIENT_SECRET"] as const;

export function walmartConnection(env: NodeJS.ProcessEnv = process.env): { connected: boolean; missing: string[] } {
  const missing = WALMART_ENV_KEYS.filter((key) => !env[key]?.trim());
  return { connected: missing.length === 0, missing };
}

export type WalmartOrderLine = {
  orderId: string;
  sku: string;
  qty: number;
  itemPriceCents: number;
};

/** Reads a Walmart orders payload. Returns no rows when the payload has none. */
export function parseWalmartOrders(body: string): WalmartOrderLine[] {
  const parsed = JSON.parse(body) as {
    list?: { elements?: { order?: { purchaseOrderId?: string; orderLines?: { orderLine?: { item?: { sku?: string }; orderLineQuantity?: { amount?: string }; charges?: { charge?: { chargeAmount?: { amount?: number } }[] } }[] } }[] } };
  };
  const orders = parsed.list?.elements?.order ?? [];
  return orders.flatMap((order) => {
    const lines = order.orderLines?.orderLine ?? [];
    return lines.flatMap((line) => {
      const sku = line.item?.sku?.trim();
      const qty = Number(line.orderLineQuantity?.amount ?? "");
      const amount = line.charges?.charge?.[0]?.chargeAmount?.amount;
      if (!order.purchaseOrderId || !sku || !(qty > 0) || amount == null) return [];
      return [{ orderId: order.purchaseOrderId, sku, qty, itemPriceCents: Math.round(amount * 100) }];
    });
  });
}

type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export async function walmartToken(env: NodeJS.ProcessEnv, fetchImpl: FetchLike = fetch): Promise<string> {
  const connection = walmartConnection(env);
  if (!connection.connected) throw new Error(`Walmart is not connected. Missing ${connection.missing.join(", ")}.`);
  const basic = Buffer.from(`${env.WALMART_CLIENT_ID}:${env.WALMART_CLIENT_SECRET}`).toString("base64");
  const response = await fetchImpl("https://marketplace.walmartapis.com/v3/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "WM_SVC.NAME": "Walmart Marketplace",
      "WM_QOS.CORRELATION_ID": crypto.randomUUID(),
    },
    body: "grant_type=client_credentials",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Walmart login failed (${response.status}). ${text.slice(0, 180)}`);
  const parsed = JSON.parse(text) as { access_token?: string };
  if (!parsed.access_token) throw new Error("Walmart did not return an access token.");
  return parsed.access_token;
}
