import { mayShowNsfMark } from "@/lib/nsf-listings";

export function NsfMark({
  listing,
}: {
  listing: { active: boolean; tradeName: string; maxUseMgL: { toString(): string } | number; function: string } | null;
}) {
  if (!mayShowNsfMark(listing)) return null;
  const max = typeof listing!.maxUseMgL === "number" ? listing!.maxUseMgL : Number(listing!.maxUseMgL);
  return (
    <aside className="nsf-mark">
      <strong>NSF/ANSI/CAN 60</strong>
      <span>
        Listed as {listing!.tradeName}. {listing!.function}. Maximum use {max} mg/L.
        Confirm the current listing at info.nsf.org before you rely on this mark.
      </span>
    </aside>
  );
}
