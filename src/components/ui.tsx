import { usd } from "@/lib/format";

export function Flash({ error, notice }: { error?: string; notice?: string }) {
  if (error) return <div className="banner bad" role="alert">Problem: {error}</div>;
  if (notice) return <div className="banner good" role="status">Done: {notice}</div>;
  return null;
}

export function Money({ cents }: { cents: number }) {
  return <span>{usd(cents)}</span>;
}

export async function readQuery(searchParams: Promise<Record<string, string | string[] | undefined>>) {
  const value = await searchParams;
  const one = (key: string) => {
    const raw = value[key];
    return (Array.isArray(raw) ? raw[0] : raw) ?? "";
  };
  return { error: one("error"), notice: one("notice"), q: one("q"), from: one("from"), to: one("to") };
}
