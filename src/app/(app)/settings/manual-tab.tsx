import { ManualBody } from "@/components/manual-body";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { blocksOf, mayEditManual, parseManual } from "@/lib/manual";
import { shippedManual } from "@/lib/manual-source";
import { requireActor } from "@/server/actor";
import { saveManual } from "@/server/help-actions";

export async function ManualTab({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [actor, query, saved] = await Promise.all([
    requireActor(),
    readQuery(searchParams),
    prisma.operatingManual.findUnique({ where: { id: "manual" } }),
  ]);
  const markdown = saved?.body || shippedManual();
  const doc = parseManual(markdown);
  const owner = mayEditManual(actor.role);
  return (
    <article className="manual">
      <Flash error={query.error} notice={query.notice} />
      {doc.preamble ? <p>{doc.preamble}</p> : null}
      {doc.sections.map((section) => {
        const Heading = section.level === 2 ? "h2" : "h3";
        return (
          <section key={section.id} id={section.id}>
            <Heading>{section.title}</Heading>
            <ManualBody blocks={blocksOf(section.body)} />
          </section>
        );
      })}
      {owner ? (
        <details>
          <summary>Edit this manual</summary>
          <p>You are the owner, so you can change the wording. The section links have to stay.</p>
          <form action={saveManual}>
            <label className="field">Manual
              <textarea name="body" rows={16} defaultValue={markdown} />
            </label>
            <button className="btn" type="submit">Save the manual</button>
          </form>
        </details>
      ) : (
        <p>Only the owner can edit this manual.</p>
      )}
    </article>
  );
}
