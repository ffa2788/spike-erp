import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { ensureFoundation } from "./services/money";

export function seedChoice(env: NodeJS.ProcessEnv = process.env): "example" | "owner" {
  return env.SEED_EXAMPLE === "yes" ? "example" : "owner";
}

export function ownerIdentity(env: NodeJS.ProcessEnv): { email: string; name: string } {
  const email = (env.OWNER_EMAIL ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Set OWNER_EMAIL to the owner's email. The production seed does not create an example user.");
  }
  const name = (env.OWNER_NAME ?? "").trim() || "FFA";
  return { email, name };
}

export function generatePassword(): string {
  return randomBytes(24).toString("base64url");
}

export function initialPassword(env: NodeJS.ProcessEnv, random: () => string = generatePassword): { password: string; generated: boolean } {
  const given = (env.OWNER_PASSWORD ?? "").trim();
  if (given && given.length < 8) throw new Error("OWNER_PASSWORD must be at least 8 characters.");
  if (given) return { password: given, generated: false };
  return { password: random(), generated: true };
}

export function passwordFilePath(env: NodeJS.ProcessEnv): string {
  return (env.OWNER_PASSWORD_FILE ?? "").trim() || "owner-initial-password.txt";
}

export async function writeInitialPassword(file: string, email: string, password: string): Promise<void> {
  await writeFile(file, `email: ${email}\npassword: ${password}\n`, { mode: 0o600 });
}

export async function seedOwner(env: NodeJS.ProcessEnv = process.env): Promise<{ created: boolean; passwordFile?: string }> {
  const existing = await prisma.user.count();
  if (existing > 0) {
    console.log("An account already exists. The owner seed did not change the database.");
    return { created: false };
  }
  const { email, name } = ownerIdentity(env);
  const { password, generated } = initialPassword(env);
  const user = await prisma.user.create({
    data: {
      email,
      name,
      role: "OWNER",
      passwordHash: await bcrypt.hash(password, 10),
      totpEnabled: false,
      totpSecret: null,
    },
  });
  const foundation = await ensureFoundation({ id: user.id, name: user.name, role: "OWNER" }, { example: false });
  if (!foundation.ok) throw new Error(foundation.error);
  await prisma.companyProfile.create({
    data: {
      legalName: (env.COMPANY_LEGAL_NAME ?? "").trim() || "SPER Chemical Corporation",
      address: (env.COMPANY_ADDRESS ?? "").trim(),
      city: (env.COMPANY_CITY ?? "").trim() || "Clearwater",
      state: (env.COMPANY_STATE ?? "").trim() || "FL",
      zip: (env.COMPANY_ZIP ?? "").trim(),
      phone: (env.COMPANY_PHONE ?? "").trim(),
      nsfNote: "",
      showExampleBanner: false,
      trevorEmail: (env.TREVOR_EMAIL ?? "").trim(),
    },
  });
  if (!generated) {
    console.log("Owner created from OWNER_PASSWORD. The password was not printed and was not written to a file.");
    return { created: true };
  }
  const file = passwordFilePath(env);
  await writeInitialPassword(file, email, password);
  console.log(`Owner created. The initial password is in ${file}. Store it in a password manager and delete the file. It was not printed here.`);
  return { created: true, passwordFile: file };
}
