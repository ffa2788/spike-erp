import type { Metadata } from "next";
import "./globals.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "SPIKE — SPER Chemical",
  description: "Sales, planning, inventory, and books for SPER Chemical.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
