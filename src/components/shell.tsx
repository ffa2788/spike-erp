"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, FlaskConical, Home, Landmark, Receipt, Settings, ShoppingCart, Warehouse } from "lucide-react";
import { SHARED_NAV } from "@/lib/roles";

const ICONS = {
  "/": Home,
  "/sales": Receipt,
  "/products": FlaskConical,
  "/inventory": Warehouse,
  "/purchasing": ShoppingCart,
  "/money": Landmark,
  "/documents": FileText,
  "/settings": Settings,
} as const;

export function SideNav() {
  const path = usePathname();
  return (
    <nav>
      {SHARED_NAV.map((group) => (
        <div key={group.label}>
          <div className="nav-group">{group.label}</div>
          {group.links.map((link) => {
            const active = link.href === "/" ? path === "/" : path === link.href || path.startsWith(`${link.href}/`);
            const Icon = ICONS[link.href as keyof typeof ICONS] ?? Home;
            return (
              <Link key={link.href} href={link.href} data-active={active ? "true" : "false"}>
                <Icon aria-hidden="true" strokeWidth={1.75} />
                {link.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
