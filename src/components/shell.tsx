"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navForRole } from "@/lib/roles";
import type { RoleName } from "@/lib/permissions";

export function SideNav({ role }: { role: RoleName }) {
  const path = usePathname();
  const visible = navForRole(role);
  return (
    <nav>
      {visible.map((group) => (
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
