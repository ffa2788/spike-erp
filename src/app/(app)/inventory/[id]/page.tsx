import Link from "next/link";
import { notFound } from "next/navigation";
import { Flash, readQuery } from "@/components/ui";
import { prisma } from "@/lib/db";
import { todayInput, toDateInput } from "@/lib/dates";
import { formatDate, formatQty, usd, usdPrecise } from "@/lib/format";
import { descendantLotIds, traceBackward, type BatchLink, type TraceNode } from "@/lib/genealogy";
import { QC_LABEL } from "@/lib/labels";
import { currentStock } from "@/lib/read-models";
import { lotQty } from "@/lib/inventory";
import { lotAdjust, lotReject, lotRelease, lotTransfer } from "@/server/work-actions";

export const dynamic = "force-dynamic";

function Tree({ node }: { node: TraceNode }) {
  return (
    <li>
      <strong>{node.lotNumber}</strong> {node.productName}
      {node.inputs.length > 0 && (
        <ul>{node.inputs.map((child) => <Tree key={child.lotId} node={child} />)}</ul>
      )}
    </li>
  );
}

export default async function LotPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await readQuery(searchParams);
  const lot = await prisma.lot.findUnique({
    where: { id },
    include: { product: { include: { specs: true } }, qcResults: true, outputOf: true },
  });
  if (!lot) notFound();
  const [stock, locations, batches, deliveries] = await Promise.all([
    currentStock(),
    prisma.location.findMany({ orderBy: { code: "asc" } }),
    prisma.productionBatch.findMany({ include: { consumptions: { include: { lot: { include: { product: true } } } }, outputLot: true, product: true } }),
    prisma.deliveryLine.findMany({ include: { delivery: { include: { order: { include: { party: true } } } } } }),
  ]);
  const balance = stock.find((item) => item.lotId === lot.id);
  const links: BatchLink[] = batches.filter((batch) => batch.outputLotId).map((batch) => ({
    batchNumber: batch.number,
    outputLotId: batch.outputLotId!,
    outputLotNumber: batch.outputLot?.lotNumber ?? "",
    outputProduct: batch.product.name,
    inputs: batch.consumptions.filter((row) => row.lotId).map((row) => ({
      lotId: row.lotId!,
      lotNumber: row.lot?.lotNumber ?? "",
      productName: row.lot?.product.name ?? "",
      qty: Number(row.qty),
    })),
  }));
  const lots = new Map(stock.map((item) => {
    const name = item.productId === lot.productId ? lot.product.name : item.lotNumber;
    return [item.lotId, { lotNumber: item.lotNumber, productName: name }] as const;
  }));
  const allLots = await prisma.lot.findMany({ include: { product: true } });
  for (const item of allLots) lots.set(item.id, { lotNumber: item.lotNumber, productName: item.product.name });
  const back = traceBackward(lot.id, lots, links);
  const family = new Set(descendantLotIds(lot.id, links));
  const shipments = deliveries.filter((line) => family.has(line.lotId));
  return (
    <>
      <h1>Lot {lot.lotNumber}</h1>
      <p className="lede">{lot.product.name} · {QC_LABEL[lot.qcStatus]} · {usdPrecise(Number(lot.unitCost))} per {lot.product.unit}</p>
      <Flash error={query.error} notice={query.notice} />
      <dl>
        <dt>On hand</dt><dd>{formatQty(balance ? lotQty(balance) : 0, lot.product.unit)} · {usd(balance ? Math.round(lotQty(balance) * Number(lot.unitCost) * 100) : 0)}</dd>
        <dt>Where</dt><dd>{balance?.locations.map((place) => `${place.locationCode} ${formatQty(place.qty)}`).join(", ") || "None"}</dd>
        <dt>Made or received</dt><dd>{formatDate(lot.manufacturedOn ?? lot.receivedOn)}</dd>
        <dt>Expires</dt><dd>{formatDate(lot.expiresOn)}</dd>
        <dt>Supplier lot</dt><dd>{lot.supplierLot || "—"}</dd>
        <dt>NSF/ANSI 60</dt><dd>{lot.nsfEligible ? "Eligible" : "Not eligible"}</dd>
        {lot.outputOf && <><dt>Batch</dt><dd><Link href={`/production/${lot.outputOf.id}`}>{lot.outputOf.number}</Link></dd></>}
      </dl>
      <div className="row">
        <Link className="btn" href={`/print/label/${lot.id}?pack=product`}>Print product label</Link>
        <Link className="btn secondary" href={`/print/label/${lot.id}?pack=drum`}>Drum label</Link>
        <Link className="btn secondary" href={`/print/label/${lot.id}?pack=tote`}>Tote label</Link>
        <Link className="btn secondary" href={`/print/certificate/${lot.id}`}>Lot certificate</Link>
      </div>
      <h2>Where this lot came from</h2>
      <ul><Tree node={back} /></ul>
      <h2>Where it went</h2>
      {shipments.length === 0 && <p>No shipment yet.</p>}
      <ul>
        {shipments.map((line) => (
          <li key={line.id}>
            <Link href={`/sales/deliveries/${line.deliveryId}`}>{line.delivery.number}</Link>
            {" "}to {line.delivery.order.party.name} · {formatQty(Number(line.qty))}
          </li>
        ))}
      </ul>
      {lot.qcStatus === "QUARANTINE" && (
        <form action={lotRelease}>
          <input type="hidden" name="id" value={lot.id} />
          <h2>Release this lot</h2>
          <p>Only a released lot can ship or be used in another batch.</p>
          {lot.product.specs.map((spec) => (
            <label className="field" key={spec.id}>
              {spec.parameter} ({spec.min != null ? `at least ${Number(spec.min)}` : "no low end"} to {spec.max != null ? Number(spec.max) : "no high end"} {spec.unit})
              <input type="hidden" name="parameter" value={spec.parameter} />
              <input name="value" required />
            </label>
          ))}
          {lot.product.specs.length === 0 && (
            <label className="field">Type RELEASE to confirm<input name="confirmation" /></label>
          )}
          <label className="field">Date<input type="date" name="releasedOn" defaultValue={todayInput()} required /></label>
          <button className="btn" type="submit">Release the lot</button>
        </form>
      )}
      {lot.qcStatus === "QUARANTINE" && (
        <form action={lotReject}>
          <input type="hidden" name="id" value={lot.id} />
          <label className="field">Reject instead<input name="note" placeholder="Why it failed" /></label>
          <button className="btn secondary" type="submit">Reject this lot</button>
        </form>
      )}
      {lot.qcResults.length > 0 && (
        <>
          <h2>Quality results</h2>
          <ul>{lot.qcResults.map((result) => <li key={result.id}>{result.parameter}: {Number(result.value)} {result.unit} · {result.passed ? "Pass" : "Fail"}</li>)}</ul>
        </>
      )}
      <details>
        <summary>Move or correct the quantity</summary>
        <form action={lotTransfer}>
          <input type="hidden" name="id" value={lot.id} />
          <div className="grid-2">
            <label className="field">From<select name="fromLocationId">{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
            <label className="field">To<select name="toLocationId">{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
            <label className="field">Quantity<input name="qty" /></label>
            <label className="field">Date<input type="date" name="date" defaultValue={todayInput()} /></label>
          </div>
          <button className="btn secondary" type="submit">Move</button>
        </form>
        <form action={lotAdjust}>
          <input type="hidden" name="id" value={lot.id} />
          <p>A quantity correction posts to the books. Warehouse staff cannot do this.</p>
          <label className="field">Location<select name="locationId">{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
          <label className="field">New quantity in that location<input name="newQty" /></label>
          <label className="field">Reason<input name="reason" /></label>
          <label className="field">Date<input type="date" name="date" defaultValue={toDateInput(new Date())} /></label>
          <button className="btn secondary" type="submit">Correct the quantity</button>
        </form>
      </details>
    </>
  );
}
