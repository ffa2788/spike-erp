import { NextResponse, type NextRequest } from "next/server";
import { readToken } from "./lib/session-token";

const OPEN = ["/login", "/login/code", "/login/enroll"];

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
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
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|examples/).*)"],
};
