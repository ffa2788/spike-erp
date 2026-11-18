export type SalesInvoice = {
  id: string;
  number: string;
  issuedOn: string;
  partyName: string;
  channel: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  feeCents: number;
  lines: {
    productId: string;
    productName: string;
    qty: number;
    amountCents: number;
    cogsCents: number;
  }[];
};

export function buildSalesReport(invoices: SalesInvoice[]) {
  const subtotalCents = invoices.reduce((sum, invoice) => sum + invoice.subtotalCents, 0);
  const taxCents = invoices.reduce((sum, invoice) => sum + invoice.taxCents, 0);
  const totalCents = invoices.reduce((sum, invoice) => sum + invoice.totalCents, 0);
  const feeCents = invoices.reduce((sum, invoice) => sum + invoice.feeCents, 0);
  const cogsCents = invoices.reduce(
    (sum, invoice) => sum + invoice.lines.reduce((lineSum, line) => lineSum + line.cogsCents, 0),
    0,
  );
  const byCustomer = group(invoices, (invoice) => invoice.partyName);
  const byChannel = group(invoices, (invoice) => invoice.channel);
  const productMap = new Map<string, { name: string; qty: number; amountCents: number; cogsCents: number }>();
  for (const invoice of invoices) {
    for (const line of invoice.lines) {
      const row = productMap.get(line.productId) ?? { name: line.productName, qty: 0, amountCents: 0, cogsCents: 0 };
      row.qty += line.qty;
      row.amountCents += line.amountCents;
      row.cogsCents += line.cogsCents;
      productMap.set(line.productId, row);
    }
  }
  const byProduct = [...productMap.entries()]
    .map(([id, row]) => ({ id, ...row, marginCents: row.amountCents - row.cogsCents }))
    .sort((a, b) => b.amountCents - a.amountCents);
  return {
    invoiceCount: invoices.length,
    subtotalCents,
    taxCents,
    totalCents,
    feeCents,
    cogsCents,
    marginCents: subtotalCents - cogsCents,
    marginAfterFeesCents: subtotalCents - cogsCents - feeCents,
    byCustomer,
    byChannel,
    byProduct,
  };
}

function group(invoices: SalesInvoice[], keyOf: (invoice: SalesInvoice) => string) {
  const map = new Map<string, { amountCents: number; totalCents: number; cogsCents: number; count: number }>();
  for (const invoice of invoices) {
    const key = keyOf(invoice);
    const row = map.get(key) ?? { amountCents: 0, totalCents: 0, cogsCents: 0, count: 0 };
    row.amountCents += invoice.subtotalCents;
    row.totalCents += invoice.totalCents;
    row.cogsCents += invoice.lines.reduce((sum, line) => sum + line.cogsCents, 0);
    row.count += 1;
    map.set(key, row);
  }
  return [...map.entries()]
    .map(([name, row]) => ({ name, ...row, marginCents: row.amountCents - row.cogsCents }))
    .sort((a, b) => b.amountCents - a.amountCents);
}
