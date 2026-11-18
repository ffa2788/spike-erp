import { describe, expect, it } from "vitest";
import { isLocked, LOCKOUT_LIMIT, LOCKOUT_WINDOW_MS } from "@/lib/lockout";
import { twoFactorRequired } from "@/lib/two-factor";

describe("REQUIRE_2FA", () => {
  it("stays off unless the value is exactly true", () => {
    expect(twoFactorRequired({})).toBe(false);
    expect(twoFactorRequired({ REQUIRE_2FA: "" })).toBe(false);
    expect(twoFactorRequired({ REQUIRE_2FA: "false" })).toBe(false);
    expect(twoFactorRequired({ REQUIRE_2FA: "TRUE" })).toBe(false);
    expect(twoFactorRequired({ REQUIRE_2FA: "1" })).toBe(false);
    expect(twoFactorRequired({ REQUIRE_2FA: "true" })).toBe(true);
  });

  it("still locks the account after 8 failures inside 15 minutes", () => {
    const now = Date.now();
    const failures = Array.from({ length: LOCKOUT_LIMIT }, () => ({ at: now - 1000, success: false }));
    expect(LOCKOUT_WINDOW_MS).toBe(15 * 60 * 1000);
    expect(isLocked(failures, now)).toBe(true);
    expect(isLocked(failures.slice(0, LOCKOUT_LIMIT - 1), now)).toBe(false);
  });
});
