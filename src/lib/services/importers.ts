import { parseDateInput } from "../dates";
import { parseCsv } from "../csv";
import { detectKind, validateAccounts, validateCustomers, validateItems, validateJournal, type ExistingKeys } from "../peachtree";
import { validateAmazonOrders } from "../amazon";
import { err, ok, type Result } from "../result";
import { prisma } from "../db";
import { savePartyTx, saveProductTx } from "./masters";
import { postJournal, run, type Actor, type Tx } from "./shared";
import { createAmazonSale } from "./sales";

async function existingKeys(tx: Tx): Promise<ExistingKeys> {
  const [parties, products, accounts] = await Promise.all([
    tx.party.findMany(),
    tx.product.findMany(),
    tx.account.findMany(),
  ]);
  return {
    partyCodes: parties.map((party) => party.code),
    partyNames: parties.map((party) => party.nameKey),
    parties: parties.map((party) => ({ code: party.code, nameKey: party.nameKey, isCustomer: party.isCustomer, isVendor: party.isVendor })),
    skus: products.map((product) => product.sku),
    productNames: products.map((product) => product.nameKey),
    accountCodes: accounts.map((account) => account.code),
  };
}

export async function previewPeachtree(csv: string, kind?: string) {
  const table = parseCsv(csv);
  const detected = detectKind(table.headers);
  const use = (kind || detected) as ReturnType<typeof detectKind>;
  if (!use) return { kind: null as null, error: "SPIKE could not tell what kind of Peachtree file this is. Choose customers, suppliers, items, accounts, or a journal." };
  return { kind: use, table };
}

export async function commitPeachtree(actor: Actor, csv: string, kind: string): Promise<Result<{ saved: number; skipped: number }>> {
  const denied = actor.role === "OWNER" || actor.role === "PARTNER" ? null : err("Your role cannot do that.");
  if (denied) return denied;
  const table = parseCsv(csv);
  if (table.rows.length > 2000) return err("This file has more than 2,000 rows. Split it and try again.");
  return run(async (tx) => {
    const keys = await existingKeys(tx);
    if (kind === "customers" || kind === "vendors") {
      const preview = validateCustomers(table.rows, keys, kind === "vendors");
      for (const row of preview.ready) {
        if (row.action === "add-role") {
          const current = await tx.party.findUnique({ where: { code: row.code } });
          if (!current) return err(`ID ${row.code} was not found.`);
          const keep = (currentValue: string, nextValue: string) => (currentValue.trim() ? currentValue : nextValue);
          await tx.party.update({
            where: { id: current.id },
            data: {
              isCustomer: current.isCustomer || kind === "customers",
              isVendor: current.isVendor || kind === "vendors",
              contactName: keep(current.contactName, row.contactName),
              email: keep(current.email, row.email),
              phone: keep(current.phone, row.phone),
              billStreet: keep(current.billStreet, row.billStreet),
              billCity: keep(current.billCity, row.billCity),
              billState: keep(current.billState, row.billState),
              billZip: keep(current.billZip, row.billZip),
              shipStreet: keep(current.shipStreet, row.billStreet),
              shipCity: keep(current.shipCity, row.billCity),
              shipState: keep(current.shipState, row.billState),
              shipZip: keep(current.shipZip, row.billZip),
              paymentTermsDays: current.paymentTermsDays === 30 && row.paymentTermsDays !== 30 ? row.paymentTermsDays : current.paymentTermsDays,
              leadTimeDays: current.leadTimeDays ?? row.leadTimeDays,
              w9OnFile: current.w9OnFile || row.w9OnFile,
              infoReturn: current.infoReturn === "NONE" ? row.infoReturn : current.infoReturn,
            },
          });
          await tx.auditLog.create({
            data: { userId: actor.id, userName: actor.name, action: "update", entity: "Party", entityId: current.id, summary: `Added the ${kind === "vendors" ? "vendor" : "customer"} role to ${current.code}.` },
          });
          continue;
        }
        const saved = await savePartyTx(tx, actor, {
          code: row.code,
          name: row.name,
          isCustomer: kind === "customers",
          isVendor: kind === "vendors",
          channel: "DIRECT",
          contactName: row.contactName,
          email: row.email,
          phone: row.phone,
          billStreet: row.billStreet,
          billCity: row.billCity,
          billState: row.billState,
          billZip: row.billZip,
          shipStreet: row.billStreet,
          shipCity: row.billCity,
          shipState: row.billState,
          shipZip: row.billZip,
          taxLocality: "",
          paymentTermsDays: row.paymentTermsDays,
          creditLimitCents: 0,
          taxExempt: false,
          exemptionNumber: "",
          exemptionState: "",
          exemptionExpires: null,
          leadTimeDays: null,
          notes: "Imported from a Peachtree file.",
          active: true,
        });
        if (!saved.ok) return saved;
      }
      return ok({ saved: preview.ready.length, skipped: preview.rows.length - preview.ready.length });
    }
    if (kind === "items") {
      const preview = validateItems(table.rows, keys);
      for (const row of preview.ready) {
        const saved = await saveProductTx(tx, actor, {
          sku: row.sku,
          name: row.name,
          kind: row.kind,
          unit: row.unit,
          category: "",
          standardCost: row.standardCost,
          listPrice: row.listPrice,
          allowOneDollar: false,
          sellable: row.sellable,
          taxable: true,
          trackInventory: row.trackInventory,
          minQty: 0,
          shelfLifeDays: null,
          pack: "",
          casNumber: "",
          preferredVendorId: null,
          leadTimeDays: null,
          nsfCertified: false,
          nsfCertNumber: "",
          nsfBody: "",
          nsfUses: "",
          nsfIssuedOn: null,
          nsfExpiresOn: null,
          nsfFormulaVersion: null,
          nsfClaim: "",
          ghsSignal: "",
          ghsPictograms: "",
          hazardStatements: "",
          precautionary: "",
          notes: "Imported from a Peachtree file.",
          active: true,
        });
        if (!saved.ok) return saved;
      }
      return ok({ saved: preview.ready.length, skipped: preview.rows.length - preview.ready.length });
    }
    if (kind === "accounts") {
      const preview = validateAccounts(table.rows, keys);
      for (const row of preview.ready) {
        await tx.account.create({ data: { code: row.code, name: row.name, type: row.type } });
      }
      return ok({ saved: preview.ready.length, skipped: preview.rows.length - preview.ready.length });
    }
    if (kind === "journal") {
      const preview = validateJournal(table.rows, keys);
      let saved = 0;
      for (const group of preview.ready) {
        const date = parseDateInput(group.date);
        if (!date) return err(`Reference ${group.reference} has a bad date.`);
        const already = await tx.journalEntry.findFirst({ where: { source: "PEACHTREE", sourceId: group.reference } });
        if (already) continue;
        const posted = await postJournal(tx, actor, {
          date,
          memo: `${group.reference}: ${group.memo}`,
          source: "PEACHTREE",
          sourceId: group.reference,
          lines: group.lines.map((line) => ({
            accountCode: line.accountCode,
            debitCents: line.debitCents,
            creditCents: line.creditCents,
            memo: line.memo,
          })),
        });
        if (!posted.ok) return posted;
        saved += 1;
      }
      return ok({ saved, skipped: preview.rows.filter((row) => row.status === "error").length + (preview.ready.length - saved) });
    }
    return err("Choose customers, suppliers, items, accounts, or a journal.");
  });
}

export async function commitAmazon(actor: Actor, csv: string): Promise<Result<{ invoices: number }>> {
  return commitMarketplace(actor, csv, "AMAZON");
}

export async function commitMarketplace(actor: Actor, csv: string, channel: "AMAZON" | "WALMART"): Promise<Result<{ invoices: number }>> {
  const table = parseCsv(csv);
  const products = await prisma.product.findMany();
  const preview = validateAmazonOrders(
    table.rows,
    products.map((product) => ({ sku: product.sku, sellable: product.sellable, priceStatus: product.priceStatus })),
  );
  if (preview.rows.some((row) => row.status === "error")) {
    return err(preview.rows.find((row) => row.status === "error")?.messages[0] ?? "The Amazon file has a problem.");
  }
  const amazon = await prisma.party.findFirst({ where: { channel, isCustomer: true } });
  if (!amazon) return err(`Add a customer with the ${channel === "WALMART" ? "Walmart" : "Amazon"} channel before importing orders.`);
  let invoices = 0;
  for (const order of preview.ready) {
    const product = products.find((item) => item.sku === order.sku);
    if (!product) return err(`SKU ${order.sku} was not found.`);
    const date = parseDateInput(order.date);
    if (!date) return err(`Order ${order.orderId} has a bad date.`);
    const saved = await createAmazonSale(actor, {
      partyId: amazon.id,
      orderId: order.orderId,
      date,
      productId: product.id,
      qty: order.qty,
      itemPriceCents: order.itemPriceCents,
      feeCents: order.referralFeeCents + order.fbaFeeCents,
    });
    if (!saved.ok) return err(`${saved.error} ${invoices} earlier order(s) in the file were saved.`);
    invoices += 1;
  }
  return ok({ invoices });
}
