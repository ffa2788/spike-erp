import { toDateInput } from "../dates";
import { inventoryAccount } from "../chart";
import { rollUpCost } from "../costing";
import { fefoAllocate, lotQty, reliefCents, roundQty, valueCents } from "../inventory";
import { finishJournal, wipJournal } from "../journals";
import { releaseEligibility } from "../nsf";
import { err, ok, type Result } from "../result";
import { audit, deny, loadBalances, locationByCode, nextNumber, postJournal, run, type Actor, type Tx } from "./shared";

export async function createBatch(
  actor: Actor,
  input: { productId: string; plannedQty: number; notes: string; isExample?: boolean },
): Promise<Result<{ id: string }>> {
  const denied = deny(actor, "produce");
  if (denied) return denied;
  return run(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: input.productId } });
    if (!product || product.kind !== "FINISHED" || !product.active) return err("Choose an active finished product.");
    const formula = await tx.formula.findFirst({
      where: { productId: product.id, isDefault: true },
      include: { lines: true },
    });
    if (!formula) return err(`${product.name} has no default formula.`);
    const products = await tx.product.findMany();
    const formulas = await tx.formula.findMany({ where: { isDefault: true }, include: { lines: true } });
    const rolled = rollUpCost(
      product.id,
      products.map((item) => ({
        id: item.id,
        sku: item.sku,
        name: item.name,
        kind: item.kind,
        standardCost: Number(item.standardCost),
      })),
      formulas.map((item) => ({
        productId: item.productId,
        isDefault: true,
        lines: item.lines.map((line) => ({ ingredientId: line.ingredientId, percent: Number(line.percent) })),
      })),
    );
    if (rolled.status !== "OK" || rolled.costPerUnit == null) {
      return err(rolled.problems[0] ?? `${product.name} does not have a usable recipe cost, so the batch cannot be started.`);
    }
    if (!(input.plannedQty > 0)) return err("Enter a quantity greater than zero.");
    const batch = await tx.productionBatch.create({
      data: {
        number: await nextNumber(tx, "batch"),
        productId: product.id,
        formulaId: formula.id,
        formulaVersion: formula.version,
        plannedQty: input.plannedQty,
        notes: input.notes.trim(),
        operatorName: actor.name,
        isExample: input.isExample ?? false,
      },
    });
    await audit(tx, actor, "create", "ProductionBatch", batch.id, `Planned batch ${batch.number} of ${product.name}.`);
    return ok({ id: batch.id });
  });
}

export async function startBatch(actor: Actor, batchId: string, startedOn: Date): Promise<Result<{ id: string }>> {
  const denied = deny(actor, "produce");
  if (denied) return denied;
  return run(async (tx) => {
    const batch = await tx.productionBatch.findUnique({
      where: { id: batchId },
      include: { formula: { include: { lines: { include: { ingredient: true } } } }, product: true },
    });
    if (!batch) return err("That batch was not found.");
    if (batch.status !== "PLANNED") return err("This batch has already been started.");
    const asOf = toDateInput(startedOn);
    const productIds = batch.formula.lines.map((line) => line.ingredientId);
    const mutable = (await loadBalances(tx, productIds)).map((lot) => ({
      ...lot,
      locations: lot.locations.map((location) => ({ ...location })),
    }));
    const credits = new Map<string, number>();
    let wipCents = 0;
    for (const line of batch.formula.lines) {
      const qty = roundQty((Number(batch.plannedQty) * Number(line.percent)) / 100);
      if (qty <= 0) continue;
      const ingredient = line.ingredient;
      if (!ingredient.trackInventory) {
        if (!(Number(ingredient.standardCost) > 0)) return err(`${ingredient.name} has no real cost.`);
        await tx.batchConsumption.create({
          data: {
            batchId: batch.id,
            productId: ingredient.id,
            qty,
            unitCost: ingredient.standardCost,
          },
        });
        continue;
      }
      const allocation = fefoAllocate(mutable, ingredient.id, qty, asOf);
      if (!allocation.ok) return err(`${ingredient.name}: ${allocation.error}`);
      const account = inventoryAccount(ingredient.kind);
      if (!account) return err(`${ingredient.name} has no inventory account.`);
      for (const pick of allocation.picks) {
        const lot = mutable.find((item) => item.lotId === pick.lotId);
        const place = lot?.locations.find((item) => item.locationId === pick.locationId);
        if (!lot || !place) return err("A lot changed while the batch was being started.");
        const before = lotQty(lot);
        place.qty = roundQty(place.qty - pick.qty);
        const cents = reliefCents(before, lotQty(lot), lot.unitCost);
        wipCents += cents;
        credits.set(account, (credits.get(account) ?? 0) + cents);
        await tx.batchConsumption.create({
          data: { batchId: batch.id, lotId: pick.lotId, productId: ingredient.id, qty: pick.qty, unitCost: lot.unitCost },
        });
        await tx.movement.create({
          data: {
            lotId: pick.lotId,
            productId: ingredient.id,
            locationId: pick.locationId,
            qty: -pick.qty,
            reason: "PRODUCTION",
            refType: "ProductionBatch",
            refId: batch.id,
            note: batch.number,
          },
        });
      }
    }
    let journalId: string | null = null;
    if (wipCents > 0) {
      const journal = await postJournal(tx, actor, {
        date: startedOn,
        memo: `Started batch ${batch.number}`,
        source: "PRODUCTION_START",
        sourceId: batch.id,
        lines: wipJournal([...credits.entries()].map(([accountCode, cents]) => ({ accountCode, cents }))),
        isExample: batch.isExample,
      });
      if (!journal.ok) return journal;
      journalId = journal.value;
    }
    await tx.productionBatch.update({
      where: { id: batch.id },
      data: { status: "IN_PROCESS", startedOn, wipCents, journalId },
    });
    await audit(tx, actor, "start", "ProductionBatch", batch.id, `Started batch ${batch.number} and consumed the ingredients.`);
    return ok({ id: batch.id });
  });
}

export async function finishBatch(
  actor: Actor,
  input: { batchId: string; actualQty: number; closedOn: Date },
): Promise<Result<{ lotId: string }>> {
  const denied = deny(actor, "produce");
  if (denied) return denied;
  return run(async (tx) => {
    const batch = await tx.productionBatch.findUnique({
      where: { id: input.batchId },
      include: { consumptions: true, product: true },
    });
    if (!batch) return err("That batch was not found.");
    if (batch.status !== "IN_PROCESS") return err("Start the batch before finishing it.");
    if (!(input.actualQty > 0)) return err("Enter the quantity you actually made.");
    const utilityCents = batch.consumptions
      .filter((row) => !row.lotId)
      .reduce((sum, row) => sum + valueCents(Number(row.qty), Number(row.unitCost)), 0);
    const wipCents = batch.wipCents ?? 0;
    const totalCents = wipCents + utilityCents;
    if (totalCents <= 0) return err("This batch has no cost, so it cannot be finished.");
    const unitCost = totalCents / 100 / input.actualQty;
    const fgCents = valueCents(input.actualQty, unitCost);
    const journal = await postJournal(tx, actor, {
      date: input.closedOn,
      memo: `Finished batch ${batch.number}`,
      source: "PRODUCTION_FINISH",
      sourceId: batch.id,
      lines: finishJournal({ wipCents, utilityCents, fgCents }),
      isExample: batch.isExample,
    });
    if (!journal.ok) return journal;
    const qc = await locationByCode(tx, "QC");
    const expires = batch.product.shelfLifeDays
      ? new Date(input.closedOn.getTime() + batch.product.shelfLifeDays * 86400000)
      : null;
    const lot = await tx.lot.create({
      data: {
        lotNumber: await nextNumber(tx, "lot"),
        productId: batch.productId,
        qcStatus: "QUARANTINE",
        unitCost,
        manufacturedOn: input.closedOn,
        expiresOn: expires,
        origin: "PRODUCTION",
        formulaVersion: batch.formulaVersion,
        nsfEligible: false,
        isExample: batch.isExample,
        notes: `Made on ${batch.number}`,
      },
    });
    await tx.movement.create({
      data: {
        lotId: lot.id,
        productId: batch.productId,
        locationId: qc.id,
        qty: input.actualQty,
        reason: "PRODUCTION",
        refType: "ProductionBatch",
        refId: batch.id,
        note: batch.number,
      },
    });
    await tx.productionBatch.update({
      where: { id: batch.id },
      data: { status: "CLOSED", actualQty: input.actualQty, closedOn: input.closedOn, outputLotId: lot.id },
    });
    await audit(tx, actor, "finish", "ProductionBatch", batch.id, `Finished ${batch.number}. Lot ${lot.lotNumber} is waiting for quality.`);
    return ok({ lotId: lot.id });
  });
}

export async function saveQcResults(
  actor: Actor,
  lotId: string,
  results: { parameter: string; value: number }[],
): Promise<Result<{ lotId: string }>> {
  const denied = deny(actor, "releaseQc");
  if (denied) return denied;
  return run((tx) => writeResults(tx, actor, lotId, results));
}

async function writeResults(
  tx: Tx,
  actor: Actor,
  lotId: string,
  results: { parameter: string; value: number }[],
): Promise<Result<{ lotId: string }>> {
  const lot = await tx.lot.findUnique({ where: { id: lotId }, include: { product: { include: { specs: true } } } });
  if (!lot) return err("That lot was not found.");
  if (lot.qcStatus !== "QUARANTINE") return err("Quality results can be changed only while the lot is waiting.");
  await tx.qcResult.deleteMany({ where: { lotId } });
  for (const spec of lot.product.specs) {
    const entered = results.find((result) => result.parameter.trim().toLowerCase() === spec.parameter.toLowerCase());
    if (!entered || !Number.isFinite(entered.value)) continue;
    const min = spec.min == null ? null : Number(spec.min);
    const max = spec.max == null ? null : Number(spec.max);
    const passed = (min == null || entered.value >= min) && (max == null || entered.value <= max);
    await tx.qcResult.create({
      data: {
        lotId,
        parameter: spec.parameter,
        value: entered.value,
        min: spec.min,
        max: spec.max,
        unit: spec.unit,
        passed,
      },
    });
  }
  await audit(tx, actor, "qc", "Lot", lotId, `Recorded quality results for lot ${lot.lotNumber}.`);
  return ok({ lotId });
}

export async function releaseLot(
  actor: Actor,
  input: { lotId: string; releasedOn: Date; results: { parameter: string; value: number }[]; confirmation: string },
): Promise<Result<{ lotId: string }>> {
  const denied = deny(actor, "releaseQc");
  if (denied) return denied;
  return run(async (tx) => {
    const written = await writeResults(tx, actor, input.lotId, input.results);
    if (!written.ok) return written;
    const lot = await tx.lot.findUnique({
      where: { id: input.lotId },
      include: { product: { include: { specs: true } }, qcResults: true },
    });
    if (!lot) return err("That lot was not found.");
    if (lot.qcStatus !== "QUARANTINE") return err("This lot is not waiting for quality.");
    if (lot.product.specs.length === 0) {
      if (lot.product.nsfCertified) return err("Add quality checks on the product before releasing an NSF/ANSI 60 lot.");
      if (input.confirmation.trim().toUpperCase() !== "RELEASE") {
        return err('Type RELEASE to confirm. This product has no quality checks on file.');
      }
    } else {
      for (const spec of lot.product.specs) {
        const result = lot.qcResults.find((item) => item.parameter === spec.parameter);
        if (!result) return err(`Enter a result for ${spec.parameter}.`);
        if (!result.passed) return err(`${spec.parameter} is outside the allowed range, so the lot cannot be released.`);
      }
    }
    const asOf = toDateInput(input.releasedOn);
    const eligibility = releaseEligibility({
      nsfCertified: lot.product.nsfCertified,
      nsfExpiresOn: lot.product.nsfExpiresOn ? toDateInput(lot.product.nsfExpiresOn) : null,
      nsfFormulaVersion: lot.product.nsfFormulaVersion,
      formulaVersion: lot.formulaVersion,
      asOf,
      specsPassed: true,
    });
    if (lot.product.nsfCertified && !eligibility.nsfEligible) return err(eligibility.note);
    const main = await locationByCode(tx, "MAIN");
    const balances = await loadBalances(tx, [lot.productId]);
    const balance = balances.find((item) => item.lotId === lot.id);
    for (const place of balance?.locations ?? []) {
      if (place.locationId === main.id || place.qty <= 0) continue;
      await tx.movement.create({
        data: {
          lotId: lot.id,
          productId: lot.productId,
          locationId: place.locationId,
          qty: -place.qty,
          reason: "QC_RELEASE",
          refType: "Lot",
          refId: lot.id,
        },
      });
      await tx.movement.create({
        data: {
          lotId: lot.id,
          productId: lot.productId,
          locationId: main.id,
          qty: place.qty,
          reason: "QC_RELEASE",
          refType: "Lot",
          refId: lot.id,
          note: "Moved to the main warehouse",
        },
      });
    }
    await tx.lot.update({
      where: { id: lot.id },
      data: {
        qcStatus: "APPROVED",
        nsfEligible: eligibility.nsfEligible,
        releasedOn: input.releasedOn,
        releasedBy: actor.name,
      },
    });
    await audit(tx, actor, "release", "Lot", lot.id, `Released lot ${lot.lotNumber}. ${eligibility.note}`);
    return ok({ lotId: lot.id });
  });
}

export async function rejectLot(actor: Actor, lotId: string, note: string): Promise<Result<{ lotId: string }>> {
  const denied = deny(actor, "releaseQc");
  if (denied) return denied;
  return run(async (tx) => {
    const lot = await tx.lot.findUnique({ where: { id: lotId } });
    if (!lot) return err("That lot was not found.");
    if (lot.qcStatus !== "QUARANTINE") return err("Only a lot that is waiting can be rejected.");
    if (note.trim().length < 8) return err("Write a short reason for the rejection.");
    await tx.lot.update({
      where: { id: lot.id },
      data: { qcStatus: "REJECTED", notes: note.trim(), nsfEligible: false },
    });
    await audit(tx, actor, "reject", "Lot", lot.id, `Rejected lot ${lot.lotNumber}. ${note.trim()}`);
    return ok({ lotId: lot.id });
  });
}
