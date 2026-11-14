import { buildSds, buildTds, type SdsInput } from "../sds";
import { mayShowNsfMark } from "../nsf-listings";
import { err, ok, type Result } from "../result";
import { audit, deny, nextNumber, run, type Actor, type Tx } from "./shared";
import { toDateInput } from "../dates";

async function snapshotFor(tx: Tx, productId: string, kind: "TDS" | "SDS") {
  const product = await tx.product.findUnique({
    where: { id: productId },
    include: {
      nsfListing: true,
      formulas: { where: { isDefault: true }, include: { lines: { include: { ingredient: true } } } },
    },
  });
  if (!product) return null;
  const formula = product.formulas[0];
  const company = await tx.companyProfile.findUnique({ where: { id: "company" } });
  const listing = mayShowNsfMark(product.nsfListing)
    ? {
        tradeName: product.nsfListing!.tradeName,
        maxUseMgL: String(Number(product.nsfListing!.maxUseMgL)),
        function: product.nsfListing!.function,
      }
    : null;
  const gravity = formula?.specificGravity ?? product.specificGravity;
  const input: SdsInput & { description: string } = {
    productName: product.name,
    sku: product.sku,
    company: company?.legalName ?? "SPER Chemical",
    address: company ? `${company.address}, ${company.city}, ${company.state} ${company.zip}` : "Clearwater, FL",
    phone: company?.phone ?? "",
    revision: toDateInput(new Date()),
    version: 0,
    form: product.form === "LIQUID" ? "Liquid" : product.form === "POWDER" ? "Powder" : product.kind,
    appearance: product.appearance,
    specificGravity: gravity != null ? String(Number(gravity)) : "",
    ph: product.phText,
    flashPoint: product.flashPoint,
    solubility: product.solubility,
    signal: product.ghsSignal,
    classification: product.ghsClassification,
    pictograms: product.ghsPictograms,
    hazardStatements: product.hazardStatements,
    precautionary: product.precautionary,
    unNumber: product.unNumber,
    shippingName: product.properShippingName,
    transportClass: product.transportClass,
    packingGroup: product.packingGroup,
    description: product.notes,
    nsf: listing,
    ingredients: (formula?.lines ?? []).map((line) => ({
      name: line.ingredient.name,
      cas: line.ingredient.casNumber,
      percent: Number(line.percent),
      classification: line.ingredient.ghsClassification,
      signal: line.ingredient.ghsSignal,
      pictograms: line.ingredient.ghsPictograms,
      hazardStatements: line.ingredient.hazardStatements,
      precautionary: line.ingredient.precautionary,
    })),
  };
  const last = await tx.safetyDocument.findFirst({
    where: { productId, kind },
    orderBy: { version: "desc" },
  });
  input.version = (last?.version ?? 0) + 1;
  const body = kind === "SDS" ? buildSds(input) : buildTds(input);
  return { product, input, body, version: input.version };
}

export async function generateDocument(actor: Actor, productId: string, kind: "TDS" | "SDS"): Promise<Result<{ id: string }>> {
  const denied = deny(actor, "editMasters");
  if (denied) return denied;
  return run(async (tx) => {
    const built = await snapshotFor(tx, productId, kind);
    if (!built) return err("That product was not found.");
    const doc = await tx.safetyDocument.create({
      data: {
        number: await nextNumber(tx, "doc"),
        productId,
        kind,
        version: built.version,
        status: "DRAFT",
        revisionOn: new Date(),
        title: kind === "SDS" ? `SDS ${built.product.name} v${built.version}` : `TDS ${built.product.name} v${built.version}`,
        snapshot: { input: built.input, body: built.body, needsReview: true },
        isExample: built.product.isExample,
      },
    });
    await audit(tx, actor, "create", "SafetyDocument", doc.id, `Draft ${kind} ${doc.number} needs a qualified review before release.`);
    return ok({ id: doc.id });
  });
}

export async function reviewDocument(actor: Actor, id: string, note: string): Promise<Result<{ id: string }>> {
  const denied = deny(actor, "releaseQc");
  if (denied) return denied;
  if (note.trim().length < 8) return err("Write a short review note. This is the qualified review.");
  return run(async (tx) => {
    const doc = await tx.safetyDocument.findUnique({ where: { id } });
    if (!doc) return err("That document was not found.");
    if (doc.status === "PUBLISHED") return err("This version is already published.");
    await tx.safetyDocument.update({
      where: { id },
      data: { status: "REVIEWED", reviewNote: note.trim(), reviewedBy: actor.name, reviewedAt: new Date() },
    });
    await audit(tx, actor, "review", "SafetyDocument", id, `${actor.name} reviewed ${doc.number}.`);
    return ok({ id });
  });
}

export async function publishDocument(actor: Actor, id: string): Promise<Result<{ id: string }>> {
  const denied = deny(actor, "releaseQc");
  if (denied) return denied;
  return run(async (tx) => {
    const doc = await tx.safetyDocument.findUnique({ where: { id } });
    if (!doc) return err("That document was not found.");
    if (doc.status !== "REVIEWED") return err("A qualified person has to review this draft before it can be published.");
    await tx.safetyDocument.update({ where: { id }, data: { status: "PUBLISHED", publishedAt: new Date() } });
    await audit(tx, actor, "publish", "SafetyDocument", id, `Published ${doc.number}.`);
    return ok({ id });
  });
}
