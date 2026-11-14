import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { todayInput } from "@/lib/dates";
import { journalAction } from "@/server/work-actions";

export const dynamic = "force-dynamic";

export default async function NewJournalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  const accounts = await prisma.account.findMany({ orderBy: { code: "asc" } });
  return (
    <>
      <h1>New journal entry</h1>
      <p className="lede">Debits must equal credits. The entry is rejected if they do not.</p>
      <Flash error={query.error} />
      <form action={journalAction}>
        <label className="field">Date<input type="date" name="date" defaultValue={todayInput()} required /></label>
        <label className="field">Why are you making this entry?<input name="memo" required /></label>
        {[0, 1, 2, 3].map((row) => (
          <div className="grid-3" key={row}>
            <label className="field">Account
              <select name="accountCode" defaultValue="">
                <option value="">None</option>
                {accounts.map((account) => <option key={account.id} value={account.code}>{account.code} {account.name}</option>)}
              </select>
            </label>
            <label className="field">Debit<input name="debit" /></label>
            <label className="field">Credit<input name="credit" /></label>
          </div>
        ))}
        <button className="btn" type="submit">Post the entry</button>
      </form>
    </>
  );
}
