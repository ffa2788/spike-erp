"use server";

import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { changedPasswordSummary, passwordProblem, resetPasswordSummary } from "@/lib/password";
import { audit } from "@/lib/services/shared";
import { requireActor, requireCan } from "./actor";
import { setSessionCookie } from "./auth-actions";
import { fail, succeed } from "./http";

export async function changePassword(formData: FormData) {
  const actor = await requireActor();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const problem = passwordProblem(next, confirm);
  if (problem) fail("/account", problem);
  const user = await prisma.user.findUnique({ where: { id: actor.id } });
  if (!user?.active) fail("/login", "Sign in again.");
  const match = await bcrypt.compare(current, user.passwordHash);
  if (!match) fail("/account", "The current password is not right.");
  const sessionVersion = user.sessionVersion + 1;
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(next, 10), mustChangePassword: false, sessionVersion },
    });
    await audit(tx, actor, "password", "User", user.id, changedPasswordSummary());
  });
  await setSessionCookie({ ...user, sessionVersion, mustChangePassword: false });
  succeed("/account", "Password changed.");
}

export async function resetUserPassword(formData: FormData) {
  const actor = await requireCan("manageUsers");
  const userId = String(formData.get("userId") ?? "");
  const password = String(formData.get("password") ?? "");
  const problem = passwordProblem(password);
  if (problem) fail("/settings?tab=users", problem);
  if (userId === actor.id) fail("/settings?tab=users", "Change your own password from My account.");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.active) fail("/settings?tab=users", "That person was not found.");
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(password, 10), mustChangePassword: true, sessionVersion: { increment: 1 } },
    });
    await audit(tx, actor, "password", "User", user.id, resetPasswordSummary(user.name));
  });
  succeed("/settings?tab=users", `Temporary password set for ${user.name}. They must change it at the next sign-in.`);
}
