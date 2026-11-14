import { formatQty } from "./format";

export function reorderSuggestion(input: {
  minQty: number;
  openSalesQty: number;
  availableQty: number;
  openPoQty: number;
  unit: string;
}): { buyQty: number; needQty: number; coveredQty: number; words: string } {
  const needQty = Math.round(Math.max(input.minQty, input.openSalesQty) * 10000) / 10000;
  const coveredQty = Math.round((input.availableQty + input.openPoQty) * 10000) / 10000;
  const buyQty = Math.round(Math.max(0, needQty - coveredQty) * 10000) / 10000;
  const words =
    buyQty > 0
      ? `Buy ${formatQty(buyQty, input.unit)}. Open orders and the reorder point need ${formatQty(needQty, input.unit)}. You have ${formatQty(input.availableQty, input.unit)} ready and ${formatQty(input.openPoQty, input.unit)} already on order.`
      : `Enough on hand. Open orders and the reorder point need ${formatQty(needQty, input.unit)}. You have ${formatQty(input.availableQty, input.unit)} ready and ${formatQty(input.openPoQty, input.unit)} on order.`;
  return { buyQty, needQty, coveredQty, words };
}
