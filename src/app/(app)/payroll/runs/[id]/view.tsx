import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatDate, usd } from "@/lib/format";
import { postPayRunAction } from "@/server/payroll-actions";

export const dynamic = "force-dynamic";

export async function PayRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await readQuery(searchParams);
  const run = await prisma.payRun.findUnique({ where: { id }, include: { stubs: { include: { employee: true } } } });
  if (!run) notFound();
  return (
    <>
      <h1>Pay run {run.number}</h1>
      <p className="lede">{formatDate(run.periodStart)} to {formatDate(run.periodEnd)}. Pay date {formatDate(run.payDate)}. {run.status}.</p>
      <p>{run.notes}</p>
      <Flash error={query.error} notice={query.notice} />
      <div className="wrap"><table>
        <thead><tr><th>Person</th><th>Gross</th><th>Federal</th><th>Social Security</th><th>Medicare</th><th>Net</th><th>FUTA</th><th>Florida</th></tr></thead>
        <tbody>
          {run.stubs.map((stub) => (
            <tr key={stub.id}>
              <td>{stub.employee.name}</td>
              <td>{usd(stub.grossCents)}</td>
              <td>{usd(stub.federalWithholdingCents)}</td>
              <td>{usd(stub.socialSecurityCents)}</td>
              <td>{usd(stub.medicareCents)}</td>
              <td>{usd(stub.netCents)}</td>
              <td>{usd(stub.futaCents)}</td>
              <td>{usd(stub.floridaCents)}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <p>FUTA and Florida reemployment tax are employer taxes. They are not deducted from net pay. This stub is a worksheet for the accountant, not a filed form.</p>
      {run.status === "DRAFT" && (
        <form action={postPayRunAction}>
          <input type="hidden" name="id" value={run.id} />
          <button className="btn" type="submit">Post this pay run</button>
        </form>
      )}
      <p><Link href="/payroll">Back to payroll</Link></p>
    </>
  );
}
