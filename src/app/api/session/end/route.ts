import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const jar = await cookies();
  jar.delete("spike_session");
  jar.delete("spike_pending");
  return NextResponse.redirect(new URL("/login", request.url));
}
