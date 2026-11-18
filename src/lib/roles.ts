export type NavLink = { href: string; label: string };
export type NavGroup = { label: string; links: NavLink[] };

/** Eight screens. FFA and Chris see the same menu. Trevor has no login. */
export const SHARED_NAV: NavGroup[] = [
  {
    label: "SPIKE",
    links: [
      { href: "/", label: "Home" },
      { href: "/sales", label: "Sales" },
      { href: "/products", label: "Products" },
      { href: "/inventory", label: "Inventory" },
      { href: "/purchasing", label: "Purchasing" },
      { href: "/money", label: "Money" },
      { href: "/documents", label: "Documents" },
      { href: "/settings", label: "Settings" },
    ],
  },
];

/** Old list screens now live as tabs. Detail records open in a drawer on that screen. */
export const FEATURE_TABS = {
  payroll: "/money?tab=payroll",
  production: "/inventory?tab=production",
  tax: "/money?tab=tax",
  coverage: "/inventory?tab=coverage",
  schedule: "/inventory?tab=schedule",
  planning: "/inventory?tab=planning",
} as const;
