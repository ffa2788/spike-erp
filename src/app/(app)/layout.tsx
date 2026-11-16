import { SideNav } from "@/components/shell";
import { logout } from "@/server/auth-actions";
import { requireActor } from "@/server/actor";
import { ROLE_LABEL } from "@/lib/permissions";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireActor();
  const company = await prisma.companyProfile.findUnique({ where: { id: "company" } });
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
        <SideNav role={user.role} />
        <div className="who">
          <strong>{user.name}</strong>
          <span>{ROLE_LABEL[user.role]}</span>
          <form action={logout}>
            <button className="btn secondary" type="submit">Sign out</button>
          </form>
        </div>
      </aside>
      <main>
        <form className="no-print" action="/search" style={{ marginBottom: "1rem" }}>
          <label className="field">Find an invoice, order, or marketplace number
            <input name="q" placeholder="S-000001, A-, W-, or E-" />
          </label>
          <button className="btn secondary" type="submit">Search</button>
        </form>
        {company?.showExampleBanner && (
          <div className="banner example">
            Example data is loaded. These are not real customers, prices, lots, or certificates.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
