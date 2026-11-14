"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const groups = [
  {
    label: "Today",
    links: [{ href: "/", label: "What needs attention" }],
  },
  {
    label: "Work",
    links: [
      { href: "/sales", label: "Sales" },
      { href: "/purchasing", label: "Purchasing" },
      { href: "/production", label: "Production" },
      { href: "/inventory", label: "Inventory" },
      { href: "/planning", label: "Planning" },
    ],
  },
  {
    label: "Records",
    links: [
      { href: "/customers", label: "Customers" },
      { href: "/vendors", label: "Suppliers" },
      { href: "/products", label: "Products" },
    ],
  },
  {
    label: "Books",
    links: [
      { href: "/money", label: "Money" },
      { href: "/money/reconcile", label: "Check the bank" },
      { href: "/reports", label: "Reports" },
    ],
  },
  {
    label: "Setup",
    links: [
      { href: "/import", label: "Bring in data" },
      { href: "/settings", label: "Settings" },
    ],
  },
];

export function SideNav() {
  const path = usePathname();
  return (
    <nav>
      {groups.map((group) => (
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
