/** The only password rule. No complexity requirements. */
export const PASSWORD_MIN = 8;

export function passwordProblem(password: string, confirm?: string): string | null {
  if (password.length < PASSWORD_MIN) return "Use at least 8 characters.";
  if (confirm !== undefined && password !== confirm) return "Type the new password again so the two match.";
  return null;
}

export function sessionMatches(tokenVersion: number | undefined, userVersion: number): boolean {
  return (tokenVersion ?? 0) === userVersion;
}

export function changedPasswordSummary(): string {
  return "Changed their password.";
}

export function resetPasswordSummary(name: string): string {
  return `Reset the password for ${name}. They must choose a new one at the next sign-in.`;
}
