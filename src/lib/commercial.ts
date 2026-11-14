export const INCOTERMS = ["EXW", "FCA", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"] as const;
export type IncotermName = (typeof INCOTERMS)[number];

export const CREDIT_TERMS = [
  { code: "PREPAID", label: "Prepaid", days: 0 },
  { code: "COD", label: "COD", days: 0 },
  { code: "NET_15", label: "Net 15", days: 15 },
  { code: "NET_30", label: "Net 30", days: 30 },
  { code: "NET_45", label: "Net 45", days: 45 },
  { code: "NET_60", label: "Net 60", days: 60 },
  { code: "CUSTOM", label: "Custom", days: null },
] as const;
export type CreditTermName = (typeof CREDIT_TERMS)[number]["code"];

export type DiscountKindName = "NONE" | "PERCENT" | "AMOUNT";

/** Incoterms 2020. Freight and insurance lines are charged only when the seller must provide them. */
export function termCharges(term: IncotermName): { sellerFreight: boolean; sellerInsurance: boolean; plain: string } {
  switch (term) {
    case "EXW":
      return { sellerFreight: false, sellerInsurance: false, plain: "You make the goods available at your place. The buyer arranges freight and insurance." };
    case "FCA":
      return { sellerFreight: false, sellerInsurance: false, plain: "You hand the goods to the buyer's carrier at the named place. The buyer pays the main freight and insurance." };
    case "FOB":
      return { sellerFreight: false, sellerInsurance: false, plain: "You load the goods on the ship at the named port. The buyer pays ocean freight and insurance." };
    case "CFR":
      return { sellerFreight: true, sellerInsurance: false, plain: "You pay freight to the named port. The buyer arranges insurance." };
    case "CIF":
      return { sellerFreight: true, sellerInsurance: true, plain: "You pay freight and insurance to the named port." };
    case "CPT":
      return { sellerFreight: true, sellerInsurance: false, plain: "You pay carriage to the named place. The buyer arranges insurance." };
    case "CIP":
      return { sellerFreight: true, sellerInsurance: true, plain: "You pay carriage and insurance to the named place." };
    case "DAP":
      return { sellerFreight: true, sellerInsurance: false, plain: "You deliver to the named place. You do not have to insure the goods under this term." };
    case "DPU":
      return { sellerFreight: true, sellerInsurance: false, plain: "You deliver and unload at the named place. You do not have to insure the goods under this term." };
    case "DDP":
      return { sellerFreight: true, sellerInsurance: false, plain: "You deliver duty paid to the named place. You do not have to insure the goods under this term." };
  }
}

export function dueDays(term: CreditTermName, customNetDays: number): number {
  const found = CREDIT_TERMS.find((item) => item.code === term);
  if (!found || found.days == null) return Math.max(0, customNetDays);
  return found.days;
}

export function termsLabel(input: { term: CreditTermName; customNetDays: number; earlyPayBps: number; earlyPayDays: number }): string {
  const base = input.term === "CUSTOM" ? `Net ${input.customNetDays}` : CREDIT_TERMS.find((item) => item.code === input.term)?.label ?? input.term;
  if (input.earlyPayBps > 0 && input.earlyPayDays > 0) {
    return `${input.earlyPayBps / 100}/${input.earlyPayDays} ${base}`;
  }
  return base;
}

export function nextRevision(current: string): string | null {
  if (!/^[A-Y]$/.test(current)) return null;
  return String.fromCharCode(current.charCodeAt(0) + 1);
}

export function quoteLabel(number: string, revision: string): string {
  return `${number} rev ${revision}`;
}

export function channelPrefix(channel: string): "S" | "A" | "W" {
  if (channel === "AMAZON") return "A";
  if (channel === "WALMART") return "W";
  return "S";
}

export function invoiceSequenceName(channel: string): string {
  return `invoice-${channelPrefix(channel)}`;
}

export function formatInvoiceNumber(channel: string, value: number): string {
  return `${channelPrefix(channel)}-${String(value).padStart(6, "0")}`;
}

/** Percent discounts use basis points: 200 means 2%. Amount discounts are cents. */
export function discountCents(baseCents: number, kind: DiscountKindName, value: number): number {
  if (baseCents <= 0 || kind === "NONE" || value <= 0) return 0;
  if (kind === "PERCENT") return Math.min(baseCents, Math.round((baseCents * value) / 10000));
  return Math.min(baseCents, Math.round(value));
}

export function resolveUnitPrice(input: {
  qty: number;
  listCents: number;
  levelCents: number | null;
  breaks: { minQty: number; unitPriceCents: number }[];
}): { unitPriceCents: number; source: string } {
  const tier = input.breaks
    .filter((row) => input.qty >= row.minQty)
    .sort((a, b) => b.minQty - a.minQty)[0];
  if (tier) return { unitPriceCents: tier.unitPriceCents, source: `Volume price at ${tier.minQty}` };
  if (input.levelCents != null) return { unitPriceCents: input.levelCents, source: "Customer price level" };
  return { unitPriceCents: input.listCents, source: "List price" };
}

export type PricedLine = {
  extendedCents: number;
  lineDiscountCents: number;
  netCents: number;
  docShareCents: number;
  afterDocCents: number;
  taxable: boolean;
};

export function priceLines(input: {
  lines: { qty: number; unitPriceCents: number; taxable: boolean; discountKind: DiscountKindName; discountValue: number }[];
  docKind: DiscountKindName;
  docValue: number;
}): { lines: PricedLine[]; goodsGrossCents: number; lineDiscountCents: number; docDiscountCents: number; goodsNetCents: number } | { error: string } {
  if (input.lines.length === 0) return { error: "Add at least one line." };
  const rough = input.lines.map((line) => {
    const extendedCents = Math.round(line.qty * line.unitPriceCents);
    if (extendedCents < 0) return null;
    const lineDiscountCents = discountCents(extendedCents, line.discountKind, line.discountValue);
    return { extendedCents, lineDiscountCents, netCents: extendedCents - lineDiscountCents, taxable: line.taxable };
  });
  if (rough.some((line) => line == null)) return { error: "A line amount cannot be negative." };
  const lines = rough as { extendedCents: number; lineDiscountCents: number; netCents: number; taxable: boolean }[];
  const goodsGrossCents = lines.reduce((sum, line) => sum + line.extendedCents, 0);
  const lineDiscountCents = lines.reduce((sum, line) => sum + line.lineDiscountCents, 0);
  const afterLines = goodsGrossCents - lineDiscountCents;
  const docDiscountCents = discountCents(afterLines, input.docKind, input.docValue);
  let remaining = docDiscountCents;
  const priced: PricedLine[] = lines.map((line, index) => {
    const share = index === lines.length - 1 || afterLines === 0
      ? remaining
      : Math.min(remaining, Math.round((docDiscountCents * line.netCents) / afterLines));
    remaining -= share;
    return { ...line, docShareCents: share, afterDocCents: line.netCents - share };
  });
  return {
    lines: priced,
    goodsGrossCents,
    lineDiscountCents,
    docDiscountCents,
    goodsNetCents: afterLines - docDiscountCents,
  };
}

export function addDaysIso(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function earlyPayOffer(input: {
  goodsNetCents: number;
  earlyPayBps: number;
  earlyPayDays: number;
  issuedOn: string;
  asOf: string;
  balanceCents: number;
}): { available: boolean; deadline: string; discountCents: number; payCents: number; message: string } {
  if (input.earlyPayBps <= 0 || input.earlyPayDays <= 0 || input.balanceCents <= 0) {
    return { available: false, deadline: input.issuedOn, discountCents: 0, payCents: input.balanceCents, message: "No early-payment discount on this invoice." };
  }
  const deadline = addDaysIso(input.issuedOn, input.earlyPayDays);
  const discountCents = Math.min(input.balanceCents, Math.round((input.goodsNetCents * input.earlyPayBps) / 10000));
  const available = input.asOf <= deadline && discountCents > 0;
  const payCents = available ? input.balanceCents - discountCents : input.balanceCents;
  const percent = (input.earlyPayBps / 100).toFixed(2).replace(/\.00$/, "");
  return {
    available,
    deadline,
    discountCents: available ? discountCents : 0,
    payCents,
    message: available
      ? `${percent}% off the goods is available through ${deadline}. Pay ${dollars(payCents)} and the discount settles the invoice.`
      : `The ${percent}% discount ended on ${deadline}. The open balance is ${dollars(input.balanceCents)}.`,
  };
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * The discount is taken only when this payment finishes the invoice inside the window.
 * Paying the full balance does not create a refund. A smaller partial payment does not earn the discount.
 */
export function applyEarlyPay(input: {
  goodsNetCents: number;
  earlyPayBps: number;
  earlyPayDays: number;
  issuedOn: string;
  paidOn: string;
  balanceCents: number;
  cashCents: number;
}): { discountCents: number; arReliefCents: number; openCents: number; message: string } {
  const offer = earlyPayOffer({ ...input, asOf: input.paidOn });
  if (!offer.available) {
    const relief = Math.min(input.cashCents, input.balanceCents);
    return { discountCents: 0, arReliefCents: relief, openCents: input.balanceCents - relief, message: offer.message };
  }
  if (input.cashCents >= input.balanceCents) {
    return { discountCents: 0, arReliefCents: input.balanceCents, openCents: 0, message: "Paid in full. The early-payment discount was not taken." };
  }
  if (input.cashCents >= offer.payCents) {
    const discountCents = input.balanceCents - input.cashCents;
    return {
      discountCents,
      arReliefCents: input.balanceCents,
      openCents: 0,
      message: `Early-payment discount of ${dollars(discountCents)} applied. The invoice is paid.`,
    };
  }
  return {
    discountCents: 0,
    arReliefCents: input.cashCents,
    openCents: input.balanceCents - input.cashCents,
    message: `This payment does not finish the invoice, so the ${offer.message.charAt(0).toLowerCase()}${offer.message.slice(1)}`,
  };
}
