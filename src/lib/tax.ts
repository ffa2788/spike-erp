export type TaxRateInput = {
  state: string;
  locality: string;
  name: string;
  rateBps: number;
  active: boolean;
};

export type TaxLineInput = { amountCents: number; taxable: boolean };

export type TaxComputation = {
  taxableCents: number;
  taxCents: number;
  exemptionApplied: boolean;
  warning: string | null;
  breakdown: { name: string; rateBps: number; taxCents: number }[];
};

export function computeSalesTax(input: {
  shipState: string;
  taxLocality: string;
  rates: TaxRateInput[];
  lines: TaxLineInput[];
  exempt: boolean;
  exemptionExpires: string | null;
  exemptionState: string | null;
  asOf: string;
}): TaxComputation {
  const taxableCents = input.lines.reduce(
    (sum, line) => sum + (line.taxable ? line.amountCents : 0),
    0,
  );
  const state = input.shipState.trim().toUpperCase();
  const locality = input.taxLocality.trim();
  const certState = (input.exemptionState ?? "").trim().toUpperCase();
  const expired = input.exemptionExpires != null && input.exemptionExpires < input.asOf;
  const stateOk = certState === "" || certState === state;

  if (input.exempt && !expired && stateOk) {
    return {
      taxableCents: 0,
      taxCents: 0,
      exemptionApplied: true,
      warning: null,
      breakdown: [],
    };
  }

  const applicable = input.rates.filter((rate) => {
    if (!rate.active) return false;
    if (rate.state.toUpperCase() !== state) return false;
    if (rate.locality === "") return true;
    return rate.locality.toLowerCase() === locality.toLowerCase();
  });

  const breakdown = applicable.map((rate) => ({
    name: rate.name,
    rateBps: rate.rateBps,
    taxCents: Math.round((taxableCents * rate.rateBps) / 10000),
  }));
  const taxCents = breakdown.reduce((sum, row) => sum + row.taxCents, 0);
  let warning: string | null = null;
  if (input.exempt && expired) {
    warning = "The exemption certificate is expired, so sales tax was charged.";
  } else if (input.exempt && !stateOk) {
    warning = `The exemption certificate is for ${certState}, not ${state}, so sales tax was charged.`;
  } else if (taxableCents > 0 && applicable.length === 0) {
    warning = `No sales tax rate is on file for ${state || "this state"}. Tax was left at zero. Add the rate before you rely on this invoice.`;
  }

  return {
    taxableCents,
    taxCents,
    exemptionApplied: false,
    warning,
    breakdown,
  };
}
