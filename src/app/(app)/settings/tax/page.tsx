import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { taxAction } from "@/server/work-actions";

export const dynamic = "force-dynamic";

export default async function TaxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await readQuery(searchParams);
  const rates = await prisma.taxRate.findMany({ orderBy: [{ state: "asc" }, { locality: "asc" }] });
  return (
    <>
      <h1>Sales tax</h1>
      <p className="lede">Active rates for the ship-to state are added together. A blank locality means the whole state. A named locality is added only when the customer uses that locality.</p>
      <Flash error={query.error} notice={query.notice} />
      <ul>
        {rates.map((rate) => (
          <li key={rate.id}>{rate.name}: {(rate.rateBps / 100).toFixed(2)}% · {rate.state} {rate.locality || "statewide"} {rate.active ? "" : "(off)"}</li>
        ))}
      </ul>
      <form action={taxAction}>
        <label className="field">Name<input name="name" required /></label>
        <label className="field">State<input name="state" maxLength={2} required /></label>
        <label className="field">Locality<input name="locality" /></label>
        <label className="field">Percent<input name="percent" required /></label>
        <button className="btn" type="submit">Add the rate</button>
      </form>
    </>
  );
}
