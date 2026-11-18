import { redirect } from "next/navigation";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = await params;
  const sp = await searchParams;
  const q = new URLSearchParams();
  q.set("formula", "1");
  q.set("id", resolved.id);
  for (const key of ["notice", "error", "pack", "q"]) {
    const value = sp[key];
    if (typeof value === "string" && value) q.set(key, value);
  }
  redirect("/products" + "?" + q.toString());
}
