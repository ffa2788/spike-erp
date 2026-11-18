import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exampleSeedBlock } from "@/lib/seed-demo";
import { initialPassword, ownerIdentity, passwordFilePath, seedChoice, writeInitialPassword } from "@/lib/seed-owner";

describe("production seed", () => {
  it("loads example data only behind the explicit flag", () => {
    expect(seedChoice({})).toBe("owner");
    expect(seedChoice({ SEED_EXAMPLE: "no" })).toBe("owner");
    expect(seedChoice({ SEED_EXAMPLE: "yes" })).toBe("example");
  });

  it("requires the owner email and does not invent an example login", () => {
    expect(() => ownerIdentity({})).toThrow(/OWNER_EMAIL/);
    expect(ownerIdentity({ OWNER_EMAIL: "Frank@Sperchemical.com" })).toEqual({ email: "frank@sperchemical.com", name: "FFA" });
  });

  it("keeps a supplied password out of a file and writes a generated one without printing it", async () => {
    expect(initialPassword({ OWNER_PASSWORD: "long-enough-password" }, () => "generated-value")).toEqual({
      password: "long-enough-password",
      generated: false,
    });
    expect(initialPassword({ OWNER_PASSWORD: "12345678" }).generated).toBe(false);
    expect(() => initialPassword({ OWNER_PASSWORD: "short" })).toThrow(/8/);
    const generated = initialPassword({}, () => "generated-value");
    expect(generated).toEqual({ password: "generated-value", generated: true });
    const dir = await mkdtemp(join(tmpdir(), "spike-owner-"));
    const file = join(dir, "owner-initial-password.txt");
    expect(passwordFilePath({ OWNER_PASSWORD_FILE: file })).toBe(file);
    await writeInitialPassword(file, "frank@sperchemical.com", generated.password);
    const text = await readFile(file, "utf8");
    expect(text).toContain("frank@sperchemical.com");
    expect(text).toContain("generated-value");
    await rm(dir, { recursive: true });
  });

  it("refuses example data on a hosted database and in production", () => {
    const local = { ALLOW_SEED: "yes", DATABASE_URL: "postgresql://localhost/spike_test", NODE_ENV: "test" };
    expect(exampleSeedBlock(local)).toBeNull();
    expect(exampleSeedBlock({ ...local, NODE_ENV: "production" })).toMatch(/production/);
    expect(exampleSeedBlock({ ...local, DATABASE_URL: "postgresql://ep.neon.tech/spike" })).toMatch(/hosted/);
    expect(exampleSeedBlock({ ALLOW_SEED: "no", DATABASE_URL: "postgresql://localhost/spike" })).toMatch(/ALLOW_SEED/);
  });
});
