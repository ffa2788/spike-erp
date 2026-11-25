export type AmazonCustomerRow = {
  id: string;
  code: string;
  name: string;
  channel: string;
  isCustomer: boolean;
};

export function planAmazonCustomer(
  customer: string,
  parties: AmazonCustomerRow[],
): { ok: true; party: AmazonCustomerRow; already: boolean } | { ok: false; error: string } {
  const wanted = customer.trim();
  if (!wanted) return { ok: false, error: "Pass --customer= with the customer ID, such as AMAZON-SALES." };
  const key = wanted.toUpperCase();
  const party = parties.find((row) => row.code.toUpperCase() === key || row.id === wanted);
  if (!party) return { ok: false, error: `Customer ${wanted} was not found.` };
  if (!party.isCustomer) return { ok: false, error: `${party.code} is not a customer.` };
  const other = parties.find((row) => row.channel === "AMAZON" && row.isCustomer && row.id !== party.id);
  if (other) return { ok: false, error: `${other.code} is already the Amazon customer. SPIKE keeps one.` };
  return { ok: true, party, already: party.channel === "AMAZON" };
}
