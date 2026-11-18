import { Suspense } from "react";
import { HelpPanel } from "@/components/help-panel";
import { SearchBox } from "@/components/search-box";
import { SideNav } from "@/components/shell";
import { logout } from "@/server/auth-actions";
import { requireActor } from "@/server/actor";
import { ROLE_LABEL } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { parseManual } from "@/lib/manual";
import { shippedManual } from "@/lib/manual-source";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireActor();
  const [company, manualRow, badge, requests] = await Promise.all([
    prisma.companyProfile.findUnique({ where: { id: "company" } }),
    prisma.operatingManual.findUnique({ where: { id: "manual" } }),
    prisma.helpRequest.count({ where: { userId: user.id, status: "answered" } }),
    prisma.helpRequest.findMany({
      where: { userId: user.id, status: { in: ["open", "answered"] } },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);
  const sections = parseManual(manualRow?.body || shippedManual()).sections;
  const initials = user.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="app">
      <aside className="nav">
        <div className="brand">
          <img src="/brand/logo.png" alt="SPER Chemical Corporation" />
          <div>
            <strong>SPIKE</strong>
            <span>Sales, planning, inventory</span>
          </div>
        </div>
        <SideNav />
      </aside>
      <div className="main-col">
        <div className="topbar no-print">
          <SearchBox />
          <div className="top-actions">
            <Suspense fallback={<button className="btn secondary" type="button">Help</button>}>
              <HelpPanel
                sections={sections}
                badge={badge}
                requests={requests.map((row) => ({
                  id: row.id,
                  screen: row.screen,
                  recordRef: row.recordRef,
                  message: row.message,
                  status: row.status,
                  answer: row.answer,
                }))}
              />
            </Suspense>
            <div className="who">
              <span className="avatar" title={ROLE_LABEL[user.role]}>{initials}</span>
              <span className="who-name">{user.name}</span>
              <form action={logout}>
                <button className="btn ghost" type="submit">Sign out</button>
              </form>
            </div>
          </div>
        </div>
        <main>
          {company?.showExampleBanner && (
            <div className="banner example">
              Example data is loaded. These are not real customers, prices, lots, or certificates.
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
