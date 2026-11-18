import Link from "next/link";
import type { ReactNode } from "react";

export function Screen({
  title,
  lede,
  primary,
  tabs,
  active,
  filters,
  children,
  drawer,
  wide,
}: {
  title: string;
  lede?: string;
  primary?: { href: string; label: string };
  tabs?: { id: string; label: string; href: string }[];
  active?: string;
  filters?: ReactNode;
  children: ReactNode;
  drawer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <section className="screen">
      <header className="screen-head">
        <div>
          <h1>{title}</h1>
          {lede ? <p className="lede">{lede}</p> : null}
        </div>
        {primary ? <Link className="btn" href={primary.href}>{primary.label}</Link> : null}
      </header>
      {tabs ? (
        <nav className="tabs">
          {tabs.map((tab) => (
            <Link key={tab.id} href={tab.href} data-active={tab.id === active ? "true" : "false"}>{tab.label}</Link>
          ))}
        </nav>
      ) : null}
      {filters}
      {drawer ? (
        <div className={wide ? "split wide" : "split"}>
          <div className="tab-body embed">{children}</div>
          <aside className="drawer">
            {drawer}
          </aside>
        </div>
      ) : (
        <div className="tab-body embed">{children}</div>
      )}
    </section>
  );
}

export function DrawerClose({ href }: { href: string }) {
  return <div className="drawer-bar"><Link href={href}>Close</Link></div>;
}

export function one(sp: Record<string, string | string[] | undefined>, key: string) {
  const raw = sp[key];
  return (Array.isArray(raw) ? raw[0] : raw) ?? "";
}
