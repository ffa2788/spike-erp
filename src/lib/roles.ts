import type { RoleName } from "./permissions";

export type NavLink = { href: string; label: string };
export type NavGroup = { label: string; links: NavLink[] };

/** Each person sees only the work they do. */
export function navForRole(role: RoleName): NavGroup[] {
  if (role === "WAREHOUSE") {
    return [
      { label: "Today", links: [{ href: "/", label: "Trevor's list" }] },
      {
        label: "Make and pack",
        links: [
          { href: "/planning/schedule", label: "What to make" },
          { href: "/production", label: "Batches" },
          { href: "/inventory", label: "Inventory and labels" },
        ],
      },
    ];
  }
  if (role === "PARTNER") {
    return [
      { label: "Today", links: [{ href: "/", label: "Office desk" }] },
      {
        label: "Sales",
        links: [
          { href: "/sales", label: "Invoices and orders" },
          { href: "/customers", label: "Customers" },
          { href: "/sales/amazon", label: "Amazon" },
          { href: "/sales/walmart", label: "Walmart" },
        ],
      },
      {
        label: "Books",
        links: [
          { href: "/money", label: "Money" },
          { href: "/money/reconcile", label: "Check the bank" },
          { href: "/payroll", label: "Payroll" },
          { href: "/tax", label: "Tax Center" },
          { href: "/reports", label: "Reports" },
        ],
      },
    ];
  }
  return [
    { label: "Today", links: [{ href: "/", label: "Today" }] },
    {
      label: "Customers",
      links: [
        { href: "/customers", label: "Customers" },
        { href: "/sales", label: "Quotes and orders" },
      ],
    },
    {
      label: "Products",
      links: [
        { href: "/products", label: "Products and formulas" },
        { href: "/documents", label: "TDS and SDS" },
      ],
    },
  ];
}

export function roleMayOpen(role: RoleName, href: string): boolean {
  if (role === "READONLY") return true;
  if (role === "OWNER") {
    return href === "/" || href.startsWith("/sales") || href.startsWith("/customers") || href.startsWith("/products") || href.startsWith("/documents") || href.startsWith("/reports/sales") || href.startsWith("/reports/margins");
  }
  const links = navForRole(role).flatMap((group) => group.links);
  return links.some((link) => href === link.href || href.startsWith(`${link.href}/`));
}
