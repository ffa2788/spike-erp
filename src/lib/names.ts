/** One commercial name, one record. Punctuation and extra spaces do not make a second item. */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function cleanCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function validCode(code: string): boolean {
  return /^[A-Z0-9][A-Z0-9-]{0,30}$/.test(code);
}
