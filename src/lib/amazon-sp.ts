import { createHash, createHmac } from "crypto";

/** Seller Central reports are the path. This connector stays off until the owner turns it on. */
export const AMAZON_SP_API_ENABLED = false;

export function spApiStatus(): { enabled: false; reason: string } {
  return {
    enabled: false,
    reason: "The Selling Partner API is not used. SPIKE posts Amazon sales from the All Orders report, the payments date range file, and the settlement flat file.",
  };
}

export const AMAZON_ENV_KEYS = [
  "AMAZON_LWA_CLIENT_ID",
  "AMAZON_LWA_CLIENT_SECRET",
  "AMAZON_REFRESH_TOKEN",
  "AMAZON_SELLER_ID",
  "AMAZON_MARKETPLACE_ID",
  "AMAZON_AWS_ACCESS_KEY_ID",
  "AMAZON_AWS_SECRET_ACCESS_KEY",
] as const;

export type AmazonEnv = NodeJS.ProcessEnv;

export function amazonConnection(env: AmazonEnv = process.env): { connected: boolean; missing: string[] } {
  const missing = AMAZON_ENV_KEYS.filter((key) => !env[key]?.trim());
  return { connected: missing.length === 0, missing };
}

export type SpOrder = {
  orderId: string;
  date: string;
  sku: string;
  qty: number;
  itemPriceCents: number;
};

type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function signingKey(secret: string, dateStamp: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, dateStamp), region), service), "aws4_request");
}

export function signSpApi(input: {
  method: string;
  path: string;
  query: string;
  body: string;
  accessToken: string;
  accessKey: string;
  secretKey: string;
  now?: Date;
  host?: string;
  region?: string;
}): { url: string; headers: Record<string, string> } {
  const host = input.host ?? "sellingpartnerapi-na.amazon.com";
  const region = input.region ?? "us-east-1";
  const now = input.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(input.body);
  const canonicalHeaders = `host:${host}\nx-amz-access-token:${input.accessToken}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-access-token;x-amz-date";
  const canonical = [input.method, input.path, input.query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${region}/execute-api/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const signature = createHmac("sha256", signingKey(input.secretKey, dateStamp, region, "execute-api"))
    .update(stringToSign, "utf8")
    .digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const url = `https://${host}${input.path}${input.query ? `?${input.query}` : ""}`;
  return {
    url,
    headers: {
      host,
      "x-amz-access-token": input.accessToken,
      "x-amz-date": amzDate,
      Authorization: authorization,
      "content-type": "application/json",
    },
  };
}

export function parseOrdersPayload(body: string): SpOrder[] {
  const parsed = JSON.parse(body) as {
    payload?: {
      Orders?: { AmazonOrderId?: string; PurchaseDate?: string }[];
      OrderItems?: {
        SellerSKU?: string;
        QuantityOrdered?: number;
        ItemPrice?: { Amount?: string };
      }[];
    };
  };
  if (parsed.payload?.OrderItems) {
    return parsed.payload.OrderItems.filter((item) => item.SellerSKU && item.QuantityOrdered).map((item) => ({
      orderId: "",
      date: "",
      sku: item.SellerSKU!,
      qty: item.QuantityOrdered!,
      itemPriceCents: Math.round(Number(item.ItemPrice?.Amount ?? "0") * 100),
    }));
  }
  return (parsed.payload?.Orders ?? []).map((order) => ({
    orderId: order.AmazonOrderId ?? "",
    date: (order.PurchaseDate ?? "").slice(0, 10),
    sku: "",
    qty: 0,
    itemPriceCents: 0,
  }));
}

export function parseFbaInventory(tsv: string): { sku: string; available: number }[] {
  return parseFbaPosition(tsv).map((row) => ({ sku: row.sku, available: row.fulfillable }));
}

/** Fulfillable quantity plus inbound working, shipped, and receiving. */
export function parseFbaPosition(tsv: string): { sku: string; fulfillable: number; inbound: number }[] {
  const lines = tsv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(/[\t,]/).map((cell) => cell.trim().toLowerCase());
  const skuIndex = headers.findIndex((header) => header === "seller-sku" || header === "sku");
  const fulfillableIndex = headers.findIndex((header) => header.includes("fulfillable") || header === "quantity available" || header === "quantity");
  const inboundIndexes = headers
    .map((header, index) => (header.includes("inbound") ? index : -1))
    .filter((index) => index >= 0);
  if (skuIndex < 0 || fulfillableIndex < 0) return [];
  return lines.slice(1).flatMap((line) => {
    const cells = line.split(/[\t,]/);
    const sku = cells[skuIndex]?.trim();
    const fulfillable = Number(cells[fulfillableIndex] ?? "");
    if (!sku || !Number.isFinite(fulfillable)) return [];
    const inbound = inboundIndexes.reduce((sum, index) => sum + (Number(cells[index]) || 0), 0);
    return [{ sku, fulfillable, inbound }];
  });
}

export async function lwaAccessToken(env: AmazonEnv, fetchImpl: FetchLike = fetch): Promise<string> {
  const connection = amazonConnection(env);
  if (!connection.connected) throw new Error(`Amazon is not connected. Missing ${connection.missing.join(", ")}.`);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: env.AMAZON_REFRESH_TOKEN!,
    client_id: env.AMAZON_LWA_CLIENT_ID!,
    client_secret: env.AMAZON_LWA_CLIENT_SECRET!,
  });
  const response = await fetchImpl("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Amazon login failed (${response.status}). ${text.slice(0, 180)}`);
  const parsed = JSON.parse(text) as { access_token?: string };
  if (!parsed.access_token) throw new Error("Amazon did not return an access token.");
  return parsed.access_token;
}

export async function spGet(input: {
  env: AmazonEnv;
  path: string;
  query?: string;
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<string> {
  const signed = signSpApi({
    method: "GET",
    path: input.path,
    query: input.query ?? "",
    body: "",
    accessToken: input.accessToken,
    accessKey: input.env.AMAZON_AWS_ACCESS_KEY_ID!,
    secretKey: input.env.AMAZON_AWS_SECRET_ACCESS_KEY!,
  });
  const response = await (input.fetchImpl ?? fetch)(signed.url, { headers: signed.headers });
  const text = await response.text();
  if (!response.ok) throw new Error(`Amazon returned ${response.status}. ${text.slice(0, 240)}`);
  return text;
}
