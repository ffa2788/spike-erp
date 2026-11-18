import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatWhen } from "@/lib/format";

export async function HelpRequestsTab({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [query, rows] = await Promise.all([
    readQuery(searchParams),
    prisma.helpRequest.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return (
    <>
      <Flash error={query.error} notice={query.notice} />
      <h2>Help requests</h2>
      <p>Chris writes these from the Help button. The SPIKE bot can answer them. FFA is emailed when one is opened. Mail is logged only until email is configured.</p>
      {rows.length === 0 ? <p>No one is stuck.</p> : (
        <div className="wrap"><table>
          <thead>
            <tr><th>When</th><th>Who</th><th>Screen</th><th>Message</th><th>Status</th><th>Answer</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{formatWhen(row.createdAt)}</td>
                <td>{row.userName}</td>
                <td>{row.screen}{row.recordRef ? ` · ${row.recordRef}` : ""}{row.screenshotName ? " · picture" : ""}</td>
                <td>{row.message}</td>
                <td>{row.status}</td>
                <td>{row.answer}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </>
  );
}
