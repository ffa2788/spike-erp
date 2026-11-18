/** Authenticator step. Only the exact value true turns it on. */
export function twoFactorRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.REQUIRE_2FA === "true";
}
