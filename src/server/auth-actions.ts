"use server";

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { Secret, TOTP } from "otpauth";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { isLocked, LOCKOUT_WINDOW_MS } from "@/lib/lockout";
import { signToken } from "@/lib/session-token";
import { fail, succeed } from "./http";
import { readToken } from "@/lib/session-token";

const cookieBase = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

function totpFor(email: string, secret: string) {
  return new TOTP({
    issuer: "SPIKE",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });
}

async function pendingUser() {
  const jar = await cookies();
  const pending = await readToken(jar.get("spike_pending")?.value);
  if (!pending?.purpose) return null;
  const user = await prisma.user.findUnique({ where: { id: pending.id } });
  if (!user?.active) return null;
  return { pending, user };
}

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const since = new Date(Date.now() - LOCKOUT_WINDOW_MS);
  const attempts = await prisma.loginAttempt.findMany({
    where: { email, at: { gte: since } },
    orderBy: { at: "desc" },
  });
  if (isLocked(attempts.map((attempt) => ({ at: attempt.at.getTime(), success: attempt.success })), Date.now())) {
    fail("/login", "Too many tries. Wait 15 minutes and try again.");
  }
  const user = await prisma.user.findUnique({ where: { email } });
  const match = user ? await bcrypt.compare(password, user.passwordHash) : false;
  await prisma.loginAttempt.create({ data: { email, success: Boolean(match && user?.active) } });
  if (!user || !match || !user.active) fail("/login", "That email or password is not right.");
  const jar = await cookies();
  const token = await signToken(
    { id: user.id, email: user.email, name: user.name, role: user.role, purpose: user.totpEnabled ? "2fa" : "enroll" },
    "10m",
  );
  jar.set("spike_pending", token, { ...cookieBase, maxAge: 60 * 10 });
  if (!user.totpEnabled) succeed("/login/enroll", "Set up the authenticator code to finish signing in.");
  succeed("/login/code", "Enter the 6-digit code from your authenticator app.");
}

export async function verifyCode(formData: FormData) {
  const code = String(formData.get("code") ?? "").replace(/\s/g, "");
  const found = await pendingUser();
  if (!found || found.pending.purpose !== "2fa" || !found.user.totpSecret) {
    fail("/login", "Sign in again, then enter the code.");
  }
  const delta = totpFor(found.user.email, found.user.totpSecret).validate({ token: code, window: 1 });
  if (delta === null) fail("/login/code", "That code is not right.");
  await startSession(found.user.id, found.user.email, found.user.name, found.user.role);
}

export async function enroll(formData: FormData) {
  const found = await pendingUser();
  if (!found || found.pending.purpose !== "enroll") fail("/login", "Sign in again to set up the authenticator.");
  let secret = found.user.totpSecret;
  if (!secret) {
    secret = new Secret({ size: 20 }).base32;
    await prisma.user.update({ where: { id: found.user.id }, data: { totpSecret: secret } });
  }
  const code = String(formData.get("code") ?? "").replace(/\s/g, "");
  if (!code) fail("/login/enroll", "Enter the 6-digit code from the authenticator app.");
  const delta = totpFor(found.user.email, secret).validate({ token: code, window: 1 });
  if (delta === null) fail("/login/enroll", "That code is not right. Check the clock on the phone and try again.");
  await prisma.user.update({ where: { id: found.user.id }, data: { totpEnabled: true, totpSecret: secret } });
  await startSession(found.user.id, found.user.email, found.user.name, found.user.role);
}

export async function enrollmentQr(): Promise<{ secret: string; qr: string } | null> {
  const found = await pendingUser();
  if (!found || found.pending.purpose !== "enroll") return null;
  let secret = found.user.totpSecret;
  if (!secret) {
    secret = new Secret({ size: 20 }).base32;
    await prisma.user.update({ where: { id: found.user.id }, data: { totpSecret: secret } });
  }
  const uri = totpFor(found.user.email, secret).toString();
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 280 });
  return { secret, qr };
}

async function startSession(id: string, email: string, name: string, role: string) {
  const jar = await cookies();
  const token = await signToken({ id, email, name, role }, "12h");
  jar.set("spike_session", token, { ...cookieBase, maxAge: 60 * 60 * 12 });
  jar.delete("spike_pending");
  succeed("/", "You are signed in.");
}

export async function logout() {
  const jar = await cookies();
  jar.delete("spike_session");
  jar.delete("spike_pending");
  succeed("/login", "You are signed out.");
}
