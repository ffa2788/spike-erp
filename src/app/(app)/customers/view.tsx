import Link from "next/link";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { CHANNEL_LABEL } from "@/lib/labels";

export const dynamic = "force-dynamic";

export async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  const rows = await prisma.party.findMany({
    where: {
      isCustomer: true,
      ...(query.q ? { OR: [{ name: { contains: query.q, mode: "insensitive" } }, { code: { contains: query.q, mode: "insensitive" } }] } : {}),
    },
    orderBy: { name: "asc" },
  });
  return (
    <>
      <Flash error={query.error} notice={query.notice} />
      <form className="search-line"><label className="field">Search<input name="q" defaultValue={query.q} /></label><button className="btn secondary">Search</button></form>
      <div className="wrap"><table>
        <thead><tr><th>ID</th><th>Name</th><th>Channel</th><th>City</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td><Link href={`/customers/${row.id}`}>{row.code}</Link></td>
              <td>{row.name}</td>
              <td>{CHANNEL_LABEL[row.channel]}</td>
              <td>{row.billCity}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </>
  );
}
