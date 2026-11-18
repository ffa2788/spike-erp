import { redirect } from "next/navigation";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  q.set("tab", "production");
  for (const key of ["notice", "error", "q"]) {
    const value = sp[key];
    if (typeof value === "string" && value) q.set(key, value);
  }
  const suffix = q.toString();
  redirect("/inventory" + (suffix ? "?" + suffix : ""));
}
