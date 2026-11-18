export type PriceStatusName = "UNSET" | "PLACEHOLDER" | "CONFIRMED";

export function priceStatusOf(price: number | null, allowOneDollar: boolean): PriceStatusName {
  if (price == null || !(price > 0)) return "UNSET";
  if (Math.abs(price - 1) < 0.0000001 && !allowOneDollar) return "PLACEHOLDER";
  return "CONFIRMED";
}

export function sellBlockReason(product: {
  active: boolean;
  sellable: boolean;
  priceStatus: PriceStatusName;
  listPrice: number | null;
}): string | null {
  if (!product.active) return "This product is inactive.";
  if (!product.sellable) return "This product is not marked as something we sell.";
  if (product.priceStatus !== "CONFIRMED" || product.listPrice == null || !(product.listPrice > 0)) {
    return "Set a real selling price first. A blank price or a $1.00 placeholder cannot be sold.";
  }
  return null;
}

export function buyPriceProblem(price: number | null, allowOneDollar: boolean): string | null {
  if (price == null || !(price > 0)) return "Enter a real price greater than zero.";
  if (Math.abs(price - 1) < 0.0000001 && !allowOneDollar) {
    return "A price of $1.00 is blocked as a placeholder. Enter the real price, or tick the box if it really is one dollar.";
  }
  return null;
}

export function parseDollars(input: string): number | null {
  const cleaned = input.trim().replace(/[$,]/g, "");
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,4})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return value;
}

export function parseQty(input: string): number | null {
  const cleaned = input.trim().replace(/,/g, "");
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,4})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!(value > 0) || !Number.isFinite(value)) return null;
  return Math.round(value * 10000) / 10000;
}

export function parseMoneyToCents(value: string): number | null {
  let cleaned = value.trim().replace(/[$,]/g, "");
  if (!cleaned) return 0;
  let negative = false;
  if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
    negative = true;
    cleaned = cleaned.slice(1, -1);
  }
  if (cleaned.startsWith("-")) {
    negative = true;
    cleaned = cleaned.slice(1);
  }
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return negative ? -cents : cents;
}
