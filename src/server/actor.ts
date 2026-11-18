import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { can, type Action, type RoleName } from "@/lib/permissions";
import { readToken } from "@/lib/session-token";
import type { Actor } from "@/lib/services/shared";

export type CurrentUser = Actor & { email: string };

export async function getActor(): Promise<CurrentUser | null> {
  const jar = await cookies();
  const session = await readToken(jar.get("spike_session")?.value);
  if (!session) return null;
  const user = await prisma.user.findUnique({ where: { id: session.id } });
  if (!user?.active) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export async function requireActor(): Promise<CurrentUser> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  return actor;
}

export async function requireCan(action: Action): Promise<CurrentUser> {
  const actor = await requireActor();
  if (!can(actor.role, action)) {
    redirect(`/?error=${encodeURIComponent("Your role cannot do that.")}`);
  }
  return actor;
}

export function roleOf(value: string): RoleName {
  if (value === "OWNER" || value === "PARTNER" || value === "WAREHOUSE" || value === "READONLY") return value;
  return "READONLY";
}
