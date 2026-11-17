import { redirectTo } from "@/lib/screen-redirect";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  redirectTo("/sales", { tab: "shipments", id }, await searchParams);
}
