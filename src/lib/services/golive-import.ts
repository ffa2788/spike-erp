import { parseDateInput } from "../dates";
import { parseCsv } from "../csv";
import { CODES } from "../chart";
import { validateBoms, validateFormulas, validateOpenAp, validateOpenAr, validateStock, validateTrial, type GoliveExisting } from "../golive";
import { resolveOpeningDate, withoutPreamble } from "../opening-date";
import { err, ok, type Result } from "../result";
import { postJournal, run, type Actor, type Tx } from "./shared";

const OPENING_SKU = "OPENING";

async function keys(tx: Tx): Promise<GoliveExisting> {
  const [products, parties, accounts, invoices, bills, lots, formulas, boms, trial] = await Promise.all([
    tx.product.findMany(),
    tx.party.findMany(),
    tx.account.findMany(),
    tx.invoice.findMany({ select: { number: true } }),
    tx.vendorBill.findMany({ select: { number: true } }),
    tx.lot.findMany({ select: { lotNumber: true } }),
    tx.formula.findMany({ where: { isDefault: true }, include: { product: true } }),
    tx.packagedSku.findMany({ include: { outputProduct: true } }),
    tx.journalEntry.findFirst({ where: { source: "OPENING", sourceId: "TRIAL" } }),
  ]);
  return {
    skus: products.map((product) => product.sku),
    partyCodes: parties.map((party) => party.code),
    accountCodes: accounts.map((account) => account.code),
    invoiceNumbers: invoices.map((invoice) => invoice.number),
    billNumbers: bills.map((bill) => bill.number),
    lotNumbers: lots.map((lot) => lot.lotNumber),
    formulaSkus: formulas.map((formula) => formula.product.sku),
    bomOutputs: boms.map((bom) => bom.outputProduct.sku),
    trialPosted: Boolean(trial),
  };
}

async function openingProduct(tx: Tx) {
  const found = await tx.product.findUnique({ where: { sku: OPENING_SKU } });
  if (found) return found;
  return tx.product.create({
    data: {
      sku: OPENING_SKU,
      name: "Opening balance",
      nameKey: "opening-balance-line",
      kind: "UTILITY",
      unit: "each",
      standardCost: 0,
      sellable: false,
      trackInventory: false,
      notes: "Used only for opening invoices and bills. Not a real product.",
    },
  });
}

export async function commitGolive(actor: Actor, csv: string, kind: string, asOf?: string | null): Promise<Result<{ saved: number; skipped: number }>> {
  if (actor.role !== "OWNER" && actor.role !== "PARTNER") return err("Your role cannot do that.");
  const table = parseCsv(withoutPreamble(csv));
  return run(async (tx) => {
    const existing = await keys(tx);
    if (kind === "stock") {
      const preview = validateStock(table.rows, existing);
      if (preview.ready.length === 0) return ok({ saved: 0, skipped: preview.rows.length });
      const dated = resolveOpeningDate({ asOf, files: [csv] });
      if (!dated.ok) return err(dated.error);
      const date = parseDateInput(dated.date);
      if (!date) return err("The as-of date must look like 2026-10-31.");
      const main = await tx.location.findUnique({ where: { code: "MAIN" } });
      if (!main) return err("The main warehouse is not set up yet.");
      let saved = 0;
      for (const row of preview.ready) {
        if (await tx.lot.findUnique({ where: { lotNumber: row.lotNumber } })) continue;
        const product = await tx.product.findUnique({ where: { sku: row.sku } });
        if (!product?.trackInventory) return err(`${row.sku} is not a stocked item.`);
        const lot = await tx.lot.create({
          data: {
            lotNumber: row.lotNumber,
            productId: product.id,
            qcStatus: "APPROVED",
            unitCost: row.unitCost,
            receivedOn: date,
            origin: "OPENING",
            releasedOn: date,
            releasedBy: actor.name,
            notes: "Opening count.",
          },
        });
        await tx.movement.create({
          data: { lotId: lot.id, productId: product.id, locationId: main.id, qty: row.qty, reason: "OPENING", refType: "Opening", refId: lot.id, at: date },
        });
        saved += 1;
      }
      return ok({ saved, skipped: preview.rows.length - saved });
    }
    if (kind === "ar") {
      const preview = validateOpenAr(table.rows, existing);
      const product = await openingProduct(tx);
      let saved = 0;
      for (const row of preview.ready) {
        if (await tx.invoice.findUnique({ where: { number: row.number } })) continue;
        const party = await tx.party.findUnique({ where: { code: row.customerCode } });
        if (!party) return err(`Customer ${row.customerCode} was not found.`);
        const issued = parseDateInput(row.date);
        const due = parseDateInput(row.due);
        if (!issued || !due) return err(`Invoice ${row.number} has a bad date.`);
        await tx.invoice.create({
          data: {
            number: row.number,
            partyId: party.id,
            issuedOn: issued,
            dueOn: due,
            status: "OPEN",
            subtotalCents: row.amountCents,
            taxCents: 0,
            totalCents: row.amountCents,
            balanceCents: row.amountCents,
            goodsNetCents: row.amountCents,
            channel: "DIRECT",
            notes: "Opening receivable. The trial balance holds the accounts receivable total.",
            lines: { create: [{ productId: product.id, description: row.description, qty: 1, unitPriceCents: row.amountCents, taxable: false }] },
          },
        });
        saved += 1;
      }
      return ok({ saved, skipped: preview.rows.length - saved });
    }
    if (kind === "ap") {
      const preview = validateOpenAp(table.rows, existing);
      const product = await openingProduct(tx);
      let saved = 0;
      for (const row of preview.ready) {
        if (await tx.vendorBill.findUnique({ where: { number: row.number } })) continue;
        const party = await tx.party.findUnique({ where: { code: row.vendorCode } });
        if (!party) return err(`Vendor ${row.vendorCode} was not found.`);
        const billed = parseDateInput(row.date);
        const due = parseDateInput(row.due);
        if (!billed || !due) return err(`Bill ${row.number} has a bad date.`);
        await tx.vendorBill.create({
          data: {
            number: row.number,
            partyId: party.id,
            vendorRef: row.number,
            billedOn: billed,
            dueOn: due,
            status: "OPEN",
            subtotalCents: row.amountCents,
            totalCents: row.amountCents,
            balanceCents: row.amountCents,
            notes: "Opening payable. The trial balance holds the accounts payable total.",
            lines: { create: [{ productId: product.id, description: row.description, qty: 1, unitPriceCents: row.amountCents, receiptValueCents: row.amountCents }] },
          },
        });
        saved += 1;
      }
      return ok({ saved, skipped: preview.rows.length - saved });
    }
    if (kind === "trial") {
      const preview = validateTrial(table.rows, existing);
      if (existing.trialPosted) return ok({ saved: 0, skipped: table.rows.length });
      if (preview.ready.length < 2) return err(preview.rows.find((row) => row.messages.length)?.messages[0] ?? "The trial balance is not ready.");
      const dated = resolveOpeningDate({ asOf, files: [csv] });
      if (!dated.ok) return err(dated.error);
      const date = parseDateInput(dated.date);
      if (!date) return err("The as-of date must look like 2026-10-31.");
      const posted = await postJournal(tx, actor, {
        date,
        memo: "Opening trial balance",
        source: "OPENING",
        sourceId: "TRIAL",
        lines: preview.ready.map((line) => ({ accountCode: line.accountCode, debitCents: line.debitCents, creditCents: line.creditCents, memo: "Opening balance" })),
      });
      if (!posted.ok) return posted;
      return ok({ saved: 1, skipped: preview.rows.filter((row) => row.status === "error").length });
    }
    if (kind === "formula") {
      const preview = validateFormulas(table.rows, existing);
      let saved = 0;
      for (const group of preview.ready) {
        const product = await tx.product.findUnique({ where: { sku: group.sku } });
        if (!product) return err(`${group.sku} was not found.`);
        const exists = await tx.formula.findFirst({ where: { productId: product.id, isDefault: true } });
        if (exists) continue;
        const lines = [];
        for (const line of group.lines) {
          const ingredient = await tx.product.findUnique({ where: { sku: line.ingredientSku } });
          if (!ingredient) return err(`Ingredient ${line.ingredientSku} was not found.`);
          lines.push({ ingredientId: ingredient.id, percent: line.percent, qtyLb: line.percent, sort: lines.length });
        }
        await tx.formula.create({
          data: { productId: product.id, version: 1, isDefault: true, batchQty: 100, notes: "Imported formula.", lines: { create: lines } },
        });
        saved += 1;
      }
      return ok({ saved, skipped: preview.rows.length - preview.ready.reduce((sum, group) => sum + group.lines.length, 0) });
    }
    if (kind === "bom") {
      const preview = validateBoms(table.rows, existing);
      let saved = 0;
      for (const group of preview.ready) {
        const output = await tx.product.findUnique({ where: { sku: group.outputSku } });
        const bulk = await tx.product.findUnique({ where: { sku: group.bulkSku } });
        if (!output || !bulk) return err("A packaging row points at an item that is not on file.");
        if (await tx.packagedSku.findUnique({ where: { outputProductId: output.id } })) continue;
        const lines = [];
        for (const line of group.lines) {
          const material = await tx.product.findUnique({ where: { sku: line.materialSku } });
          if (!material) return err(`Packaging item ${line.materialSku} was not found.`);
          lines.push({ materialId: material.id, basis: line.basis, qty: line.qty });
        }
        await tx.packagedSku.create({
          data: {
            productId: bulk.id,
            outputProductId: output.id,
            packageCode: group.packageCode,
            unitsPerCase: group.unitsPerCase,
            casesPerPallet: group.casesPerPallet,
            lines: { create: lines },
          },
        });
        saved += 1;
      }
      return ok({ saved, skipped: Math.max(0, preview.rows.length - saved) });
    }
    return err("Choose a starting file: stock, open invoices, open bills, trial balance, formulas, or packaging.");
  });
}

export { CODES };
