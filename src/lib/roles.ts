export type NavLink = { href: string; label: string };
export type NavGroup = { label: string; links: NavLink[] };

/** FFA and Chris see the same menu. Trevor has no login. */
export const SHARED_NAV: NavGroup[] = [
  { label: "Today", links: [{ href: "/", label: "What needs attention" }] },
  {
    label: "Work",
    links: [
      { href: "/sales", label: "Sales" },
      { href: "/sales/amazon", label: "Amazon" },
      { href: "/sales/walmart", label: "Walmart" },
      { href: "/purchasing", label: "Purchasing" },
      { href: "/production", label: "Production" },
      { href: "/inventory", label: "Inventory" },
      { href: "/planning", label: "Planning" },
      { href: "/planning/coverage", label: "Coverage" },
    ],
  },
  {
    label: "Records",
    links: [
      { href: "/customers", label: "Customers" },
      { href: "/vendors", label: "Suppliers" },
      { href: "/products", label: "Products" },
      { href: "/documents", label: "TDS and SDS" },
    ],
  },
  {
    label: "Books",
    links: [
      { href: "/money", label: "Money" },
      { href: "/money/reconcile", label: "Check the bank" },
      { href: "/payroll", label: "Payroll" },
      { href: "/reports", label: "Reports" },
      { href: "/tax", label: "Tax Center" },
    ],
  },
  {
    label: "Setup",
    links: [
      { href: "/import", label: "Bring in data" },
      { href: "/settings/nsf", label: "NSF listing" },
      { href: "/settings", label: "Settings" },
    ],
  },
];
