import { describe, expect, it } from "vitest";
import { changedPasswordSummary, passwordProblem, resetPasswordSummary, sessionMatches } from "@/lib/password";

describe("password rule", () => {
  it("accepts any 8 characters and rejects a shorter one", () => {
    expect(passwordProblem("12345678")).toBeNull();
    expect(passwordProblem("password")).toBeNull();
    expect(passwordProblem("1234567")).toBe("Use at least 8 characters.");
    expect(passwordProblem("")).toBe("Use at least 8 characters.");
  });

  it("checks that the confirmation matches and nothing else", () => {
    expect(passwordProblem("12345678", "12345678")).toBeNull();
    expect(passwordProblem("12345678", "12345679")).toBe("Type the new password again so the two match.");
  });

  it("treats a token from before session versions as version 0", () => {
    expect(sessionMatches(undefined, 0)).toBe(true);
    expect(sessionMatches(2, 2)).toBe(true);
    expect(sessionMatches(1, 2)).toBe(false);
  });

  it("writes audit text with no password in it", () => {
    const secret = "temporary-secret";
    expect(changedPasswordSummary()).toBe("Changed their password.");
    expect(changedPasswordSummary()).not.toContain(secret);
    expect(resetPasswordSummary("Chris")).toBe("Reset the password for Chris. They must choose a new one at the next sign-in.");
    expect(resetPasswordSummary("Chris")).not.toContain(secret);
  });
});
