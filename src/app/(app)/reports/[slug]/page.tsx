import { redirect } from "next/navigation";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = await params;
  const sp = await searchParams;
  const q = new URLSearchParams();
  q.set("tab", "reports");
  q.set("id", resolved.slug);
  for (const key of ["notice", "error", "pack", "q"]) {
    const value = sp[key];
    if (typeof value === "string" && value) q.set(key, value);
  }
  redirect("/money" + "?" + q.toString());
}
