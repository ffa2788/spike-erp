import Link from "next/link";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  const rows = await prisma.party.findMany({
    where: {
      isVendor: true,
      ...(query.q ? { OR: [{ name: { contains: query.q, mode: "insensitive" } }, { code: { contains: query.q, mode: "insensitive" } }] } : {}),
    },
    orderBy: { name: "asc" },
  });
  return (
    <>
      <div className="row"><h1>Suppliers</h1><Link className="btn" href="/vendors/new">New supplier</Link></div>
      <Flash error={query.error} notice={query.notice} />
      <div className="wrap"><table>
        <thead><tr><th>ID</th><th>Name</th><th>Lead time</th><th>City</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}><td><Link href={`/vendors/${row.id}`}>{row.code}</Link></td><td>{row.name}</td><td>{row.leadTimeDays ?? "—"} days</td><td>{row.billCity}</td></tr>
          ))}
        </tbody>
      </table></div>
    </>
  );
}
