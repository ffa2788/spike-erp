import Link from "next/link";
import { PrintButton } from "@/components/print-button";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { toDateInput } from "@/lib/dates";
import { usd } from "@/lib/format";
import { CODES } from "@/lib/chart";
import { lotQty, valueCents } from "@/lib/inventory";
import { balanceSheet, normalBalance, profitAndLoss, trialBalance } from "@/lib/journals";
import { currentStock, postedLines } from "@/lib/read-models";
import { federalReturnLines, floridaDr15, savingsIdeas, vendorInfoReturns, type DrInvoice } from "@/lib/tax-center";
import { addFixedAsset, setEntityType } from "@/server/tax-actions";

export const dynamic = "force-dynamic";

function range(low: number | null, high: number | null) {
  if (low == null || high == null) return "No dollar estimate";
  if (low === high) return usd(low);
  return `${usd(low)} to ${usd(high)}`;
}

export async function TaxCenterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  const year = /^\d{4}$/.test(query.q) ? Number(query.q) : 2026;
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const [company, lines, invoices, payments, parties, vendors, assets, stock, formulas] = await Promise.all([
    prisma.companyProfile.findUnique({ where: { id: "company" } }),
    postedLines(),
    prisma.invoice.findMany({
      where: { issuedOn: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T23:59:59Z`) } },
      include: { party: true, lines: true },
    }),
    prisma.vendorPayment.findMany({
      where: { paidOn: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T23:59:59Z`) } },
      include: { party: true },
    }),
    prisma.party.findMany({ where: { isCustomer: true } }),
    prisma.party.findMany({ where: { isVendor: true }, orderBy: { name: "asc" } }),
    prisma.fixedAsset.findMany({ orderBy: { placedInService: "asc" } }),
    currentStock(),
    prisma.formula.count(),
  ]);
  const rates = await prisma.taxRate.findMany({ where: { active: true, state: "FL", locality: { not: "" } } });
  const rateFor = (locality: string) => rates.find((rate) => rate.locality.toLowerCase() === locality.toLowerCase())?.rateBps ?? 0;
  const drInvoices: DrInvoice[] = invoices.map((invoice) => ({
    issuedOn: toDateInput(invoice.issuedOn),
    locality: invoice.party.taxLocality,
    subtotalCents: invoice.subtotalCents,
    taxableCents: invoice.taxableCents,
    taxCents: invoice.taxCents,
    exemptionApplied: invoice.exemptionApplied,
    countyRateBps: rateFor(invoice.party.taxLocality),
    lines: invoice.lines.map((line) => ({ amountCents: Math.round(Number(line.qty) * line.unitPriceCents), taxable: line.taxable })),
  }));
  const dr = floridaDr15(drInvoices, String(year));
  const paidByVendor = new Map<string, number>();
  for (const payment of payments) paidByVendor.set(payment.partyId, (paidByVendor.get(payment.partyId) ?? 0) + payment.amountCents);
  const forms = vendorInfoReturns(
    vendors.map((vendor) => ({
      name: vendor.name,
      paidCents: paidByVendor.get(vendor.id) ?? 0,
      w9OnFile: vendor.w9OnFile,
      infoReturn: vendor.infoReturn,
    })),
    year,
  );
  const pnl = profitAndLoss(lines, from, to);
  const sheet = balanceSheet(lines.filter((line) => line.date <= to), to);
  const trial = trialBalance(lines.filter((line) => line.date <= to));
  const inventoryCents = stock.reduce((sum, lot) => sum + valueCents(lotQty(lot), lot.unitCost), 0);
  const equipmentBook = normalBalance(lines.filter((line) => line.date <= to), CODES.equipment);
  const equipmentList = assets.filter((asset) => toDateInput(asset.placedInService) <= to).reduce((sum, asset) => sum + asset.costCents, 0);
  const entity = company?.entityType ?? "S_CORP";
  const mapped = federalReturnLines({
    entity,
    income: pnl.income.rows.map((row) => ({ name: row.name, cents: row.cents })),
    cogs: pnl.cogs.rows.map((row) => ({ name: row.name, cents: row.cents })),
    expense: pnl.expense.rows.map((row) => ({ name: row.name, cents: row.cents })),
    inventoryCents,
    equipmentListCents: equipmentList,
    equipmentBookCents: equipmentBook,
  });
  const today = toDateInput(new Date());
  const exemptCurrent = parties.filter((party) => party.taxExempt && party.exemptionNumber && (!party.exemptionExpires || toDateInput(party.exemptionExpires) >= today)).length;
  const exemptProblem = parties.filter((party) => party.taxExempt && (!party.exemptionNumber || (party.exemptionExpires && toDateInput(party.exemptionExpires) < today))).length;
  const ideas = savingsIdeas({
    entity,
    year,
    assets: assets.map((asset) => ({
      description: asset.description,
      costCents: asset.costCents,
      year: toDateInput(asset.placedInService).startsWith(String(year)) ? year : 0,
      candidate: asset.section179Candidate,
    })),
    formulaVersions: formulas,
    qualifiedResearchCents: 0,
    inventoryCents,
    openArCents: sheet ? normalBalance(lines, CODES.ar) : 0,
    openApCents: normalBalance(lines, CODES.ap),
    salesTaxCollectedCents: dr.collectedTaxCents,
    customersMissingCert: exemptProblem,
    customersExempt: exemptCurrent,
    retirementExpenseCents: pnl.expense.rows.filter((row) => /retire|401|pension/i.test(row.name)).reduce((sum, row) => sum + row.cents, 0),
  });
  return (
    <>
      <div className="row no-print">
        <h1>Tax Center</h1>
        <PrintButton label="Print the package" />
        <Link href="/reports">Reports</Link>
      </div>
      <p className="lede">Figures for your CPA. SPIKE reads the same books as the Today page. This is not a tax return and it is not tax advice.</p>
      <Flash error={query.error} notice={query.notice} />
      <form className="row no-print">
        <label className="field">Year<input name="q" defaultValue={String(year)} /></label>
        <button className="btn secondary" type="submit">Show that year</button>
      </form>
      <form action={setEntityType} className="row no-print">
        <label className="field">Company type
          <select name="entityType" defaultValue={entity}>
            <option value="S_CORP">S corporation — Form 1120-S</option>
            <option value="C_CORP">C corporation — Form 1120</option>
          </select>
        </label>
        <button className="btn secondary" type="submit">Save</button>
      </form>

      <h2>Florida sales tax worksheet</h2>
      <p>Form DR-15 figures for {year}. A real return is usually monthly. Exempt sales include certificates and sales where SPIKE did not charge Florida tax. Discretionary surtax is capped at the first $5,000 of each item. County rates come from the tax rates on file.</p>
      <div className="wrap"><table>
        <tbody>
          <tr><td>Line 1. Gross sales</td><td>{usd(dr.grossSalesCents)}</td></tr>
          <tr><td>Line 2. Exempt sales</td><td>{usd(dr.exemptSalesCents)}</td></tr>
          <tr><td>Line 3. Taxable amount</td><td>{usd(dr.taxableAmountCents)}</td></tr>
          <tr><td>State tax at 6%</td><td>{usd(dr.stateTaxCents)}</td></tr>
          <tr><td>Line 15(a). Amount over $5,000 not subject to surtax</td><td>{usd(dr.overCapCents)}</td></tr>
          <tr><td>Line 15(d). Discretionary surtax</td><td>{usd(dr.surtaxCents)}</td></tr>
          <tr><td>Tax computed</td><td>{usd(dr.taxDueCents)}</td></tr>
          <tr><td>Tax collected on invoices</td><td>{usd(dr.collectedTaxCents)}</td></tr>
          <tr><td>Line 11. Collection allowance if you e-file and e-pay on time</td><td>{usd(dr.collectionAllowanceCents)}</td></tr>
        </tbody>
      </table></div>
      {dr.taxDueCents !== dr.collectedTaxCents && (
        <div className="banner warn">Computed tax and tax collected differ by {usd(Math.abs(dr.taxDueCents - dr.collectedTaxCents))}. Use the collected amount when you talk to your CPA, and ask why they differ.</div>
      )}
      <div className="wrap"><table>
        <thead><tr><th>County</th><th>Taxable sales</th><th>Subject to surtax</th><th>Rate</th><th>Surtax</th></tr></thead>
        <tbody>
          {dr.counties.map((row) => (
            <tr key={row.county}><td>{row.county}</td><td>{usd(row.taxableCents)}</td><td>{usd(row.surtaxableCents)}</td><td>{(row.rateBps / 100).toFixed(2)}%</td><td>{usd(row.surtaxCents)}</td></tr>
          ))}
          {dr.counties.length === 0 && <tr><td colSpan={5}>No taxable Florida sales in this year.</td></tr>}
        </tbody>
      </table></div>

      <h2>1099 vendors and W-9s</h2>
      <p>Payments in {year}. For 2026 the reporting amount is $2,000. Goods and corporations marked “no 1099” are left off the form. This is a list for your CPA, not the IRS file.</p>
      <div className="wrap"><table>
        <thead><tr><th>Supplier</th><th>Paid</th><th>Form</th><th>W-9</th><th>What to do</th></tr></thead>
        <tbody>
          {forms.map((row) => (
            <tr key={row.name}><td>{row.name}</td><td>{usd(row.paidCents)}</td><td>{row.form}</td><td>{row.needsW9 ? "Missing" : "On file or not needed"}</td><td>{row.reason}</td></tr>
          ))}
          {forms.length === 0 && <tr><td colSpan={5}>No supplier payments in this year.</td></tr>}
        </tbody>
      </table></div>

      <h2>Year-end package for the CPA</h2>
      <p>{mapped.formName} for {year}. Book profit {usd(mapped.bookIncomeCents)}. The trial balance {trial.balanced ? "balances" : "does not balance"}. The balance sheet {sheet.balanced ? "balances" : "does not balance"}.</p>
      <div className="wrap"><table>
        <thead><tr><th>Form line</th><th>From the books</th><th>Amount</th></tr></thead>
        <tbody>
          {mapped.lines.map((line) => (
            <tr key={line.formLine}><td>{line.formLine}</td><td>{line.book}</td><td>{usd(line.cents)}</td></tr>
          ))}
        </tbody>
      </table></div>
      {equipmentList !== equipmentBook && (
        <div className="banner warn">The equipment list is {usd(equipmentList)} and account 1500 is {usd(equipmentBook)}. Your CPA needs those to match.</div>
      )}
      <h3>Trial balance</h3>
      <div className="wrap"><table>
        <thead><tr><th>Account</th><th>Debit</th><th>Credit</th></tr></thead>
        <tbody>
          {trial.rows.map((row) => (
            <tr key={row.accountCode}><td>{row.accountCode} {row.accountName}</td><td>{row.debitCents ? usd(row.debitCents) : ""}</td><td>{row.creditCents ? usd(row.creditCents) : ""}</td></tr>
          ))}
        </tbody>
      </table></div>
      <h3>Equipment list</h3>
      <ul>
        {assets.map((asset) => <li key={asset.id}>{asset.description} · placed in service {toDateInput(asset.placedInService)} · {usd(asset.costCents)}{asset.isExample ? " · example" : ""}</li>)}
        {assets.length === 0 && <li>No equipment on the list.</li>}
      </ul>
      <form action={addFixedAsset} className="no-print">
        <p>Add equipment you have paid for. SPIKE reduces cash and puts the cost on the equipment account.</p>
        <label className="field">What is it<input name="description" /></label>
        <div className="grid-2">
          <label className="field">Date you started using it<input type="date" name="placedInService" /></label>
          <label className="field">Cost<input name="cost" /></label>
        </div>
        <label className="field"><input type="checkbox" name="candidate" value="yes" defaultChecked /> Ask the CPA about section 179</label>
        <button className="btn" type="submit">Add equipment</button>
      </form>

      <h2>Savings ideas</h2>
      <p>Ordinary ideas from your own numbers. Nothing here is a tax shelter. Each estimate has to be confirmed with your CPA.</p>
      <div className="attention">
        {ideas.map((idea) => (
          <article key={idea.title} className="card">
            <strong>{idea.title}</strong>
            <span>{idea.plain}</span>
            <span>Based on: {idea.basedOn.join(". ")}.</span>
            <span>Estimate: {range(idea.lowCents, idea.highCents)}. {idea.estimateNote}</span>
            <span>{idea.citation}</span>
          </article>
        ))}
      </div>
    </>
  );
}
