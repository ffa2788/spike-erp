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
          <svg width="42" height="42" viewBox="0 0 64 64" aria-hidden="true">
            <rect width="64" height="64" rx="14" fill="#f3efe4" />
            <path d="M32 10c8 10 14 16 14 24a14 14 0 1 1-28 0c0-8 6-14 14-24z" fill="#0d5c45" />
          </svg>
          <div>
            <strong>SPIKE</strong>
            <span>SPER Chemical</span>
          </div>
        </div>
        <SideNav />
        <div className="who">
          <strong>{user.name}</strong>
          <span>{ROLE_LABEL[user.role]}</span>
          <form action={logout}>
            <button className="btn secondary" type="submit">Sign out</button>
          </form>
        </div>
      </aside>
      <main>
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
