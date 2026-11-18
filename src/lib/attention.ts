export type Attention = {
  tone: "bad" | "warn" | "info";
  title: string;
  detail: string;
  href: string;
};

export function buildAttention(input: {
  booksProblems: string[];
  overdueInvoices: { number: string; name: string; balanceCents: number; id: string }[];
  overdueBills: { number: string; name: string; balanceCents: number; id: string }[];
  quarantineLots: { lotNumber: string; productName: string; id: string }[];
  ordersToShip: { number: string; name: string; id: string }[];
  uninvoicedDeliveries: { number: string; id: string }[];
  bankOpenCount: number;
  buys: { sku: string; name: string; words: string; id: string }[];
  draftQuotes: { number: string; name: string; id: string }[];
  expiringCertificates: { name: string; expires: string; id: string }[];
  expiringNsf: { name: string; expires: string; id: string }[];
  incompleteProducts: { name: string; sku: string; id: string }[];
  usd: (cents: number) => string;
}): Attention[] {
  const items: Attention[] = [];
  if (input.booksProblems.length) {
    items.push({
      tone: "bad",
      title: "The books do not agree",
      detail: input.booksProblems[0],
      href: "/money",
    });
  }
  for (const invoice of input.overdueInvoices) {
    items.push({
      tone: "bad",
      title: `Invoice ${invoice.number} is overdue`,
      detail: `${invoice.name} still owes ${input.usd(invoice.balanceCents)}.`,
      href: `/sales/invoices/${invoice.id}`,
    });
  }
  for (const bill of input.overdueBills) {
    items.push({
      tone: "bad",
      title: `Bill ${bill.number} is overdue`,
      detail: `${bill.name} is owed ${input.usd(bill.balanceCents)}.`,
      href: `/purchasing/bills/${bill.id}`,
    });
  }
  for (const lot of input.quarantineLots.slice(0, 6)) {
    items.push({
      tone: "warn",
      title: `Lot ${lot.lotNumber} is waiting for quality`,
      detail: `${lot.productName} cannot ship or be used until it is released.`,
      href: `/inventory/${lot.id}`,
    });
  }
  for (const order of input.ordersToShip.slice(0, 6)) {
    items.push({
      tone: "warn",
      title: `Order ${order.number} still needs to ship`,
      detail: order.name,
      href: `/sales/orders/${order.id}`,
    });
  }
  for (const delivery of input.uninvoicedDeliveries.slice(0, 6)) {
    items.push({
      tone: "warn",
      title: `Delivery ${delivery.number} has not been invoiced`,
      detail: "The goods have left, and the cost is already in the books. Create the invoice to record the sale.",
      href: `/sales/deliveries/${delivery.id}`,
    });
  }
  if (input.bankOpenCount > 0) {
    items.push({
      tone: "warn",
      title: "The bank statement still has lines to match",
      detail: `${input.bankOpenCount} line${input.bankOpenCount === 1 ? "" : "s"} are not matched yet.`,
      href: "/money/reconcile",
    });
  }
  for (const buy of input.buys.slice(0, 5)) {
    items.push({
      tone: "info",
      title: `${buy.name} should be ordered`,
      detail: buy.words,
      href: `/products/${buy.id}`,
    });
  }
  for (const quote of input.draftQuotes.slice(0, 4)) {
    items.push({
      tone: "info",
      title: `Quote ${quote.number} is still a draft`,
      detail: quote.name,
      href: `/sales/quotes/${quote.id}`,
    });
  }
  for (const cert of input.expiringCertificates) {
    items.push({
      tone: "warn",
      title: `Tax certificate for ${cert.name} expires ${cert.expires}`,
      detail: "Renew it or the next invoice will charge sales tax.",
      href: `/customers/${cert.id}`,
    });
  }
  for (const cert of input.expiringNsf) {
    items.push({
      tone: "warn",
      title: `NSF/ANSI 60 certificate for ${cert.name} expires ${cert.expires}`,
      detail: "Lots cannot ship with the claim after the certificate expires.",
      href: `/products/${cert.id}`,
    });
  }
  for (const product of input.incompleteProducts.slice(0, 4)) {
    items.push({
      tone: "warn",
      title: `${product.name} does not have a usable recipe cost`,
      detail: `${product.sku} cannot be made until every ingredient, including sub-recipes, has a real cost.`,
      href: `/products/${product.id}`,
    });
  }
  return items;
}
