import { Flash, readQuery } from "@/components/ui";
import { todayInput } from "@/lib/dates";
import { formatDate, usd } from "@/lib/format";
import { bankPosition } from "@/lib/services/money";
import { bankFeeAction, bankImportAction, bankMatchAction } from "@/server/work-actions";

export const dynamic = "force-dynamic";

export default async function ReconcilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  const bank = await bankPosition();
  const suggested = new Map(bank.suggestions.map((pair) => [pair.statementId, pair.moveId]));
  const unmatchedBooks = bank.moves.filter((move) => !move.matched && move.amountCents !== 0);
  const openLines = bank.statement.filter((line) => !line.reconciled);
  const banner = bank.explained.agreesNow
    ? "The bank and the books agree."
    : openLines.length === 0 && unmatchedBooks.length > 0
      ? "Every statement line is matched. SPIKE still has payments that are not on this statement yet. That is expected until the bank shows them."
      : bank.explained.explained
        ? "The difference is explained by the lines below. Match them, or record a bank fee, and they will agree."
        : `These lines do not explain a difference of ${usd(bank.explained.gapCents)}. Look for a missing entry.`;
  return (
    <>
      <h1>Check the bank</h1>
      <p className="lede">Match the statement to payments already in SPIKE. Record a bank fee when the bank took money that is not a supplier payment.</p>
      <Flash error={query.error} notice={query.notice} />
      <div className="cards">
        <div className="card"><span>Cash in SPIKE</span><strong>{usd(bank.bookCashCents)}</strong></div>
        <div className="card"><span>Statement ending</span><strong>{bank.latest ? usd(bank.latest.endingBalanceCents) : "—"}</strong></div>
      </div>
      <div className={`banner ${bank.explained.agreesNow ? "good" : bank.explained.explained ? "warn" : "bad"}`}>
        {banner}
      </div>
      {unmatchedBooks.length > 0 && (
        <>
          <h2>In SPIKE but not on this statement</h2>
          <ul>
            {unmatchedBooks.map((move) => (
              <li key={move.journalId}>{formatDate(move.date)} · {move.label} · {usd(move.amountCents)}</li>
            ))}
          </ul>
        </>
      )}
      <form action={bankMatchAction}><button className="btn" type="submit">Match the suggested lines</button></form>
      <div className="wrap"><table>
        <thead><tr><th>Date</th><th>Description</th><th>Amount</th><th></th></tr></thead>
        <tbody>
          {bank.statement.map((line) => (
            <tr key={line.id}>
              <td>{formatDate(line.postedOn)}</td>
              <td>{line.description}{line.reconciled ? " · matched" : suggested.has(line.id) ? " · suggestion ready" : ""}</td>
              <td>{usd(line.amountCents)}</td>
              <td>
                {!line.reconciled && !suggested.has(line.id) && (
                  <form action={bankFeeAction}>
                    <input type="hidden" name="id" value={line.id} />
                    <button className="btn secondary" type="submit">{line.amountCents < 0 ? "Record as a bank fee" : "Record as other income"}</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <h2>Load a statement</h2>
      <p>Use columns Date, Description, and Amount. Amount is positive for money in and negative for money out. A second upload of the same file is ignored.</p>
      <form action={bankImportAction}>
        <label className="field">File<input type="file" name="file" accept=".csv,text/csv" /></label>
        <label className="field">Or paste<textarea name="csv" /></label>
        <label className="field">Statement date<input type="date" name="statementDate" defaultValue={todayInput()} required /></label>
        <label className="field">Ending balance<input name="ending" required /></label>
        <button className="btn secondary" type="submit">Load the statement</button>
      </form>
      <p className="muted">An example file is in the project at public/examples/bank-statement.csv. The example company already has a statement loaded.</p>
    </>
  );
}
