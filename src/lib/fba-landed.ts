/** Share inbound freight across a pallet. The last line takes the leftover cent. */
export function spreadFreight(
  parts: { key: string; qty: number; weight: number }[],
  freightCents: number,
  by: "UNITS" | "WEIGHT",
): Map<string, number> {
  const shares = new Map<string, number>();
  if (parts.length === 0 || freightCents <= 0) {
    for (const part of parts) shares.set(part.key, 0);
    return shares;
  }
  const useWeight = by === "WEIGHT" && parts.every((part) => part.weight > 0);
  const basis = parts.map((part) => (useWeight ? part.weight : part.qty));
  const total = basis.reduce((sum, value) => sum + value, 0);
  let used = 0;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      shares.set(part.key, freightCents - used);
      return;
    }
    const share = total > 0 ? Math.floor((freightCents * basis[index]) / total) : 0;
    shares.set(part.key, share);
    used += share;
  });
  return shares;
}
