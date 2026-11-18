"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { usePathname } from "next/navigation";
import { ManualBody } from "@/components/manual-body";
import { closeHelpRequest, openHelpRequest } from "@/server/help-actions";
import { blocksOf, HOW_DO_I, screenLabel, searchManual, sectionForScreen, type ManualSection } from "@/lib/manual";

export type HelpRow = {
  id: string;
  screen: string;
  recordRef: string;
  message: string;
  status: string;
  answer: string;
};

export function HelpPanel({
  sections,
  requests,
  badge,
  twoFactor = false,
}: {
  sections: ManualSection[];
  requests: HelpRow[];
  badge: number;
  twoFactor?: boolean;
}) {
  const pathname = usePathname() || "/";
  const params = useSearchParams();
  const asked = params.get("help") === "1";
  const [open, setOpen] = useState(asked);
  useEffect(() => {
    if (asked) setOpen(true);
  }, [asked]);
  const [query, setQuery] = useState("");
  const where = screenLabel(pathname, params);
  const anchor = sectionForScreen(pathname, params.get("tab") ?? "");
  const current = sections.find((section) => section.id === anchor) ?? sections[0];
  const hits = useMemo(() => searchManual(sections, query), [sections, query]);
  const answered = requests.filter((row) => row.status === "answered");
  return (
    <>
      <button className="btn secondary help-btn" type="button" onClick={() => setOpen(true)}>
        Help
        {badge > 0 ? <span className="help-badge">{badge}</span> : null}
      </button>
      {open ? (
        <div className="help-panel" role="dialog" aria-label="Help">
          <div className="drawer-bar">
            <button className="btn secondary" type="button" onClick={() => setOpen(false)}>Close</button>
          </div>
          <h2>Help</h2>
          <p className="muted">On Import, drop every Peachtree file at once. SPIKE detects each one and posts them in cutover order. The bot can do the same with POST /api/v1/imports.</p>
          <p className="muted">
            {twoFactor
              ? "Sign-in asks for an authenticator code after the password because REQUIRE_2FA is true."
              : "Sign-in is email and password. Set REQUIRE_2FA to true to ask for an authenticator code as well."}
          </p>
          {answered.length > 0 && (
            <div className="banner good">
              {answered.map((row) => (
                <div key={row.id}>
                  <p><strong>Answer on {row.screen}</strong></p>
                  <p>{row.message}</p>
                  <p>{row.answer}</p>
                  <form action={closeHelpRequest}>
                    <input type="hidden" name="id" value={row.id} />
                    <input type="hidden" name="back" value={where.screen} />
                    <button className="btn secondary" type="submit">Got it</button>
                  </form>
                </div>
              ))}
            </div>
          )}
          <label className="field">Search the manual
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="deposit, void, NSF" />
          </label>
          {query.trim().length >= 2 && (
            <ul className="help-hits">
              {hits.length === 0 ? <li>Nothing in the manual matches that.</li> : hits.map((hit) => (
                <li key={hit.id}><a href={`/settings?tab=manual#${hit.id}`}>{hit.title}</a><p>{hit.snippet}</p></li>
              ))}
            </ul>
          )}
          {current ? (
            <article id={`help-${current.id}`}>
              <h3>This screen</h3>
              <h2><a href={`/settings?tab=manual#${current.id}`}>{current.title}</a></h2>
              <ManualBody blocks={blocksOf(current.body)} />
            </article>
          ) : null}
          <h3>How do I</h3>
          <ol>
            {HOW_DO_I.map((item) => (
              <li key={item.anchor}><a href={`/settings?tab=manual#${item.anchor}`}>{item.label}</a></li>
            ))}
          </ol>
          <h3>I&apos;m stuck</h3>
          <form action={openHelpRequest}>
            <input type="hidden" name="screen" value={where.screen} />
            <input type="hidden" name="record" value={where.recordRef} />
            <input type="hidden" name="back" value={where.screen} />
            <p>This note keeps the screen{where.recordRef ? ` and record ${where.recordRef}` : ""}.</p>
            <label className="field">What happened
              <textarea name="message" required placeholder="The deposit is off by 12 cents." />
            </label>
            <label className="field">Picture, optional
              <input name="screenshot" type="file" accept="image/*" />
            </label>
            <button className="btn" type="submit">Send to Help</button>
          </form>
          {requests.some((row) => row.status === "open") && (
            <>
              <h3>Waiting</h3>
              <ul>
                {requests.filter((row) => row.status === "open").map((row) => (
                  <li key={row.id}>{row.message}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
