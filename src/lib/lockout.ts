const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

export function isLocked(attempts: { at: number; success: boolean }[], now: number): boolean {
  const failures = attempts.filter((attempt) => !attempt.success && now - attempt.at < WINDOW_MS);
  return failures.length >= MAX_FAILURES;
}

export const LOCKOUT_LIMIT = MAX_FAILURES;
export const LOCKOUT_WINDOW_MS = WINDOW_MS;
