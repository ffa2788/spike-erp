import { prisma } from "@/lib/db";
import { formatWhen } from "@/lib/format";
import { requireActor } from "@/server/actor";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function AuditPage() {
  const actor = await requireActor();
  if (!can(actor.role, "postMoney") && actor.role !== "OWNER") {
    return <p>The change history is for the owner and the partner.</p>;
  }
  const rows = await prisma.auditLog.findMany({ orderBy: { at: "desc" }, take: 200 });
  return (
    <>
      <h1>Change history</h1>
      <div className="wrap"><table>
        <thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}><td>{formatWhen(row.at)}</td><td>{row.userName}</td><td>{row.summary}</td></tr>
          ))}
        </tbody>
      </table></div>
    </>
  );
}
