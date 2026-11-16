import Link from "next/link";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { usd } from "@/lib/format";
import { quarterlyPayroll } from "@/lib/payroll";
import { ensurePayrollTable } from "@/lib/services/payroll-run";
import { createPayRunAction, reviewTaxTableAction, saveTaxTableAction } from "@/server/payroll-actions";

export const dynamic = "force-dynamic";

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  const table = await ensurePayrollTable();
  const [employees, runs, stubs] = await Promise.all([
    prisma.employee.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.payRun.findMany({ orderBy: { payDate: "desc" }, take: 12, include: { stubs: true } }),
    prisma.payStub.findMany({ where: { run: { status: "POSTED" } }, include: { run: true } }),
  ]);
  const year = Number(query.q) || new Date().getUTCFullYear();
  const quarter = (Number(query.from) || 1) as 1 | 2 | 3 | 4;
  const summary = quarterlyPayroll(year, quarter > 4 ? 1 : quarter, stubs.map((stub) => ({
    payDate: stub.run.payDate.toISOString().slice(0, 10),
    grossCents: stub.grossCents,
    federalWithholdingCents: stub.federalWithholdingCents,
    socialSecurityCents: stub.socialSecurityCents,
    medicareCents: stub.medicareCents,
    employerSocialSecurityCents: stub.employerSocialSecurityCents,
    employerMedicareCents: stub.employerMedicareCents,
    futaCents: stub.futaCents,
    floridaCents: stub.floridaCents,
    netCents: stub.netCents,
  })));
  return (
    <>
      <h1>Payroll</h1>
      <p className="lede">Three people in Clearwater. Florida has no state income tax. Give the 941, 940, and RT-6 worksheets to the accountant. SPIKE does not file them.</p>
      <Flash error={query.error} notice={query.notice} />
      <div className={`banner ${table.reviewed ? "good" : "warn"}`}>{table.note} {table.reviewed ? "Reviewed." : "Not reviewed."}</div>
      <h2>People</h2>
      <ul>
        {employees.map((employee) => <li key={employee.id}>{employee.name} · {employee.payType === "HOURLY" ? `${usd(employee.rateCents)} an hour` : `${usd(employee.rateCents)} each paycheck`} · withholding {employee.federalWithholdingBps / 100}%</li>)}
        {employees.length === 0 && <li>No employees yet.</li>}
      </ul>
      <h2>Tax table</h2>
      <p>Percents and wage bases are examples until the accountant reviews them. Changing a number clears the review.</p>
      <form action={saveTaxTableAction}>
        <div className="grid-2">
          <label className="field">Social Security percent<input name="socialSecurity" defaultValue={(table.socialSecurityBps / 100).toFixed(2)} /></label>
          <label className="field">Social Security wage base<input name="socialSecurityBase" defaultValue={(table.socialSecurityWageBaseCents / 100).toFixed(2)} /></label>
          <label className="field">Medicare percent<input name="medicare" defaultValue={(table.medicareBps / 100).toFixed(2)} /></label>
          <label className="field">FUTA percent<input name="futa" defaultValue={(table.futaBps / 100).toFixed(2)} /></label>
          <label className="field">FUTA wage base<input name="futaBase" defaultValue={(table.futaWageBaseCents / 100).toFixed(2)} /></label>
          <label className="field">Florida reemployment percent<input name="florida" defaultValue={(table.floridaBps / 100).toFixed(2)} /></label>
          <label className="field">Florida wage base<input name="floridaBase" defaultValue={(table.floridaWageBaseCents / 100).toFixed(2)} /></label>
        </div>
        <button className="btn secondary" type="submit">Save the table</button>
      </form>
      <form action={reviewTaxTableAction}>
        <input type="hidden" name="reviewed" value={table.reviewed ? "no" : "yes"} />
        <button className="btn" type="submit">{table.reviewed ? "Mark the table not reviewed" : "Accountant reviewed this table"}</button>
      </form>
      <h2>Pay run</h2>
      <form action={createPayRunAction}>
        <div className="grid-2">
          <label className="field">Period start<input type="date" name="periodStart" required /></label>
          <label className="field">Period end<input type="date" name="periodEnd" required /></label>
          <label className="field">Pay date<input type="date" name="payDate" required /></label>
          <label className="field">Amounts
            <select name="mode" defaultValue="CALCULATOR">
              <option value="CALCULATOR">Calculate from the tax table</option>
              <option value="PROVIDER">Enter the payroll provider's amounts</option>
            </select>
          </label>
        </div>
        {employees.map((employee) => (
          <div className="grid-2" key={employee.id}>
            <input type="hidden" name="employeeId" value={employee.id} />
            <p>{employee.name}</p>
            <label className="field">Hours <span>Hourly people only</span><input name={`hours-${employee.id}`} defaultValue="0" /></label>
            <label className="field">Provider gross<input name={`gross-${employee.id}`} defaultValue="0" /></label>
            <label className="field">Provider federal withholding<input name={`wh-${employee.id}`} defaultValue="0" /></label>
            <label className="field">Provider Social Security<input name={`ss-${employee.id}`} defaultValue="0" /></label>
            <label className="field">Provider Medicare<input name={`med-${employee.id}`} defaultValue="0" /></label>
            <label className="field">Provider FUTA<input name={`futa-${employee.id}`} defaultValue="0" /></label>
            <label className="field">Provider Florida reemployment<input name={`fl-${employee.id}`} defaultValue="0" /></label>
          </div>
        ))}
        <button className="btn" type="submit">Prepare the pay run</button>
      </form>
      <h2>Recent pay runs</h2>
      <ul>
        {runs.map((run) => <li key={run.id}><Link href={`/payroll/runs/${run.id}`}>{run.number}</Link> · {run.status} · {run.source === "PROVIDER" ? "provider amounts" : "calculated"} · {usd(run.stubs.reduce((sum, stub) => sum + stub.netCents, 0))} net</li>)}
        {runs.length === 0 && <li>No pay run yet.</li>}
      </ul>
      <h2>Quarterly worksheets for the accountant</h2>
      <p>{summary.from} through {summary.to}. These are summaries to hand over. SPIKE does not file Form 941, Form 940, or Florida RT-6.</p>
      <div className="cards">
        <div className="card"><span>941 wages</span><strong>{usd(summary.form941.wagesCents)}</strong><p className="muted">Withholding {usd(summary.form941.federalWithholdingCents)}. Social Security tax {usd(summary.form941.socialSecurityTaxCents)}. Medicare tax {usd(summary.form941.medicareTaxCents)}.</p></div>
        <div className="card"><span>940 FUTA this quarter</span><strong>{usd(summary.form940.quarterFutaCents)}</strong><p className="muted">Year to date {usd(summary.form940.yearToDateFutaCents)} on {usd(summary.form940.yearToDateWagesCents)} of wages.</p></div>
        <div className="card"><span>RT-6 Florida reemployment</span><strong>{usd(summary.rt6.taxCents)}</strong><p className="muted">Wages {usd(summary.rt6.wagesCents)}.</p></div>
      </div>
    </>
  );
}
