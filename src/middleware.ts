import { NextResponse, type NextRequest } from "next/server";
import { readToken } from "./lib/session-token";

const OPEN = ["/login", "/login/code", "/login/enroll"];

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path.startsWith("/api/")) return NextResponse.next();
  const session = await readToken(request.cookies.get("spike_session")?.value);
  if (OPEN.some((item) => path === item)) {
    if (session && path === "/login") {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }
  if (!session) {
    const login = new URL("/login", request.url);
    return NextResponse.redirect(login);
  }
  const sent = sendToScreen(request);
  if (sent) return sent;
  return NextResponse.next();
}

function sendToScreen(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const go = (pathname: string, extra: Record<string, string>) => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
    return NextResponse.redirect(url);
  };
  const formula = /^\/products\/([^/]+)\/formula$/.exec(path);
  if (formula) return go("/products", { id: formula[1], formula: "1" });
  const rules: [RegExp, string, string[]?][] = [
    [/^\/customers\/new$/, "/sales", ["tab", "customers", "new", "1"]],
    [/^\/customers\/([^/]+)$/, "/sales", ["tab", "customers", "id"]],
    [/^\/customers$/, "/sales", ["tab", "customers"]],
    [/^\/sales\/quotes\/new$/, "/sales", ["tab", "quotes", "new", "1"]],
    [/^\/sales\/quotes\/([^/]+)$/, "/sales", ["tab", "quotes", "id"]],
    [/^\/sales\/orders\/([^/]+)$/, "/sales", ["tab", "orders", "id"]],
    [/^\/sales\/invoices\/([^/]+)$/, "/sales", ["tab", "invoices", "id"]],
    [/^\/sales\/deliveries\/([^/]+)$/, "/sales", ["tab", "shipments", "id"]],
    [/^\/sales\/amazon(?:\/import)?$/, "/sales", ["tab", "amazon"]],
    [/^\/sales\/walmart$/, "/sales", ["tab", "walmart"]],
    [/^\/products\/new$/, "/products", ["new", "1"]],
    [/^\/products\/([^/]+)$/, "/products", ["id"]],
    [/^\/inventory\/([^/]+)$/, "/inventory", ["tab", "stock", "id"]],
    [/^\/planning\/coverage$/, "/inventory", ["tab", "coverage"]],
    [/^\/planning\/schedule$/, "/inventory", ["tab", "schedule"]],
    [/^\/planning$/, "/inventory", ["tab", "planning"]],
    [/^\/production\/new$/, "/inventory", ["tab", "production", "new", "1"]],
    [/^\/production\/([^/]+)$/, "/inventory", ["tab", "production", "id"]],
    [/^\/production$/, "/inventory", ["tab", "production"]],
    [/^\/vendors\/new$/, "/purchasing", ["tab", "suppliers", "new", "1"]],
    [/^\/vendors\/([^/]+)$/, "/purchasing", ["tab", "suppliers", "id"]],
    [/^\/vendors$/, "/purchasing", ["tab", "suppliers"]],
    [/^\/purchasing\/orders\/new$/, "/purchasing", ["tab", "orders", "new", "1"]],
    [/^\/purchasing\/orders\/([^/]+)$/, "/purchasing", ["tab", "orders", "id"]],
    [/^\/purchasing\/receipts\/([^/]+)$/, "/purchasing", ["tab", "receipts", "id"]],
    [/^\/purchasing\/bills\/([^/]+)$/, "/purchasing", ["tab", "bills", "id"]],
    [/^\/money\/journal\/new$/, "/money", ["tab", "books", "new", "1"]],
    [/^\/money\/reconcile$/, "/money", ["tab", "bank"]],
    [/^\/payroll\/runs\/([^/]+)$/, "/money", ["tab", "payroll", "id"]],
    [/^\/payroll$/, "/money", ["tab", "payroll"]],
    [/^\/tax$/, "/money", ["tab", "tax"]],
    [/^\/reports\/([^/]+)$/, "/money", ["tab", "reports", "id"]],
    [/^\/reports$/, "/money", ["tab", "reports"]],
    [/^\/documents\/([^/]+)$/, "/documents", ["id"]],
    [/^\/settings\/users$/, "/settings", ["tab", "users"]],
    [/^\/settings\/tax$/, "/settings", ["tab", "tax"]],
    [/^\/settings\/nsf$/, "/settings", ["tab", "nsf"]],
    [/^\/settings\/audit$/, "/settings", ["tab", "audit"]],
    [/^\/settings\/guide$/, "/settings", ["tab", "guide"]],
    [/^\/import$/, "/settings", ["tab", "import"]],
  ];
  for (const [pattern, pathname, spec] of rules) {
    const match = pattern.exec(path);
    if (!match) continue;
    const extra: Record<string, string> = {};
    if (spec) {
      let capture = 1;
      for (let i = 0; i < spec.length; i += 2) {
        const key = spec[i];
        const value = spec[i + 1];
        if (value === undefined) extra[key] = match[capture++] ?? "";
        else extra[key] = value;
      }
    }
    return go(pathname, extra);
  }
  return null;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|examples/).*)"],
};
