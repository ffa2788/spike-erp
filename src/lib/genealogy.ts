export type BatchLink = {
  batchNumber: string;
  outputLotId: string;
  outputLotNumber: string;
  outputProduct: string;
  inputs: { lotId: string; lotNumber: string; productName: string; qty: number }[];
};

export type TraceNode = {
  lotId: string;
  lotNumber: string;
  productName: string;
  inputs: TraceNode[];
};

export function traceBackward(
  lotId: string,
  lots: Map<string, { lotNumber: string; productName: string }>,
  batches: BatchLink[],
  guard = new Set<string>(),
): TraceNode {
  const lot = lots.get(lotId);
  const node: TraceNode = {
    lotId,
    lotNumber: lot?.lotNumber ?? lotId,
    productName: lot?.productName ?? "Unknown product",
    inputs: [],
  };
  if (guard.has(lotId)) return node;
  guard.add(lotId);
  const batch = batches.find((item) => item.outputLotId === lotId);
  if (!batch) return node;
  node.inputs = batch.inputs.map((input) => traceBackward(input.lotId, lots, batches, guard));
  return node;
}

export function descendantLotIds(lotId: string, batches: BatchLink[], guard = new Set<string>()): string[] {
  if (guard.has(lotId)) return [];
  guard.add(lotId);
  const ids = [lotId];
  for (const batch of batches) {
    if (batch.inputs.some((input) => input.lotId === lotId)) {
      ids.push(...descendantLotIds(batch.outputLotId, batches, guard));
    }
  }
  return ids;
}
