import type { Metadata } from "next";
import { DM_Sans, DM_Serif_Display } from "next/font/google";
import "./globals.css";

const body = DM_Sans({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-body" });
const display = DM_Serif_Display({ subsets: ["latin"], weight: "400", variable: "--font-display" });

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "SPIKE — SPER Chemical",
  description: "Sales, planning, inventory, and books for SPER Chemical.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable}`}>
      <body className={body.className}>{children}</body>
    </html>
  );
}
