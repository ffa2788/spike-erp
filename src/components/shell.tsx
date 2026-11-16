"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SHARED_NAV } from "@/lib/roles";

export function SideNav() {
  const path = usePathname();
  return (
    <nav>
      {SHARED_NAV.map((group) => (
        <div key={group.label}>
          <div className="nav-group">{group.label}</div>
          {group.links.map((link) => {
            const active = link.href === "/" ? path === "/" : path === link.href || path.startsWith(`${link.href}/`);
            return (
              <Link key={link.href} href={link.href} data-active={active ? "true" : "false"}>
                {link.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
