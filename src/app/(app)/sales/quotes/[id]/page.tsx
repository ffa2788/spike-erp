import { redirect } from "next/navigation";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const q = new URLSearchParams({ tab: "quotes", id });
  if (typeof sp.notice === "string" && sp.notice) q.set("notice", sp.notice);
  if (typeof sp.error === "string" && sp.error) q.set("error", sp.error);
  redirect(`/sales?${q}`);
}
