import { redirect } from "next/navigation";

export function redirectTo(
  pathname: string,
  extra: Record<string, string>,
  sp: Record<string, string | string[] | undefined>,
): never {
  const q = new URLSearchParams(extra);
  for (const key of ["notice", "error", "pack"]) {
    const value = sp[key];
    if (typeof value === "string" && value) q.set(key, value);
  }
  redirect(`${pathname}?${q}`);
}
