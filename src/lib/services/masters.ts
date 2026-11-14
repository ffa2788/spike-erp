import type { Channel, ProductKind } from "@prisma/client";
import { rollUpCost } from "../costing";
import { nameKey, validCode } from "../names";
import { buyPriceProblem, priceStatusOf } from "../pricing";
import { err, ok, type Result } from "../result";
import { audit, deny, loadBalances, run, type Actor, type Tx } from "./shared";

export type PartyInput = {
  id?: string;
  code: string;
  name: string;
  isCustomer: boolean;
  isVendor: boolean;
  channel: Channel;
  contactName: string;
  email: string;
  phone: string;
  billStreet: string;
  billCity: string;
  billState: string;
  billZip: string;
  shipStreet: string;
  shipCity: string;
  shipState: string;
  shipZip: string;
  taxLocality: string;
  paymentTermsDays: number;
  creditLimitCents: number;
  taxExempt: boolean;
  exemptionNumber: string;
  exemptionState: string;
  exemptionExpires: Date | null;
  leadTimeDays: number | null;
  notes: string;
  active: boolean;
  isExample?: boolean;
};

function stateProblem(label: string, value: string): string | null {
  if (!value) return null;
  if (!/^[A-Z]{2}$/.test(value)) return `${label} must be a two-letter state, such as FL.`;
  return null;
}

export async function saveParty(actor: Actor, input: PartyInput): Promise<Result<{ id: string }>> {
  const denied = deny(actor, "editMasters");
  if (denied) return denied;
  return run((tx) => savePartyTx(tx, actor, input));
}

export async function savePartyTx(tx: Tx, actor: Actor, input: PartyInput): Promise<Result<{ id: string }>> {
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!validCode(code)) return err("The ID should use letters, numbers, and hyphens.");
  if (!name) return err("Enter the name.");
  if (!input.isCustomer && !input.isVendor) return err("Mark this record as a customer, a supplier, or both.");
  const billState = input.billState.trim().toUpperCase();
  const shipState = input.shipState.trim().toUpperCase();
  const exemptionState = input.exemptionState.trim().toUpperCase();
  const stateError = stateProblem("Billing state", billState) || stateProblem("Shipping state", shipState) || stateProblem("Certificate state", exemptionState);
  if (stateError) return err(stateError);
  if (input.taxExempt && !input.exemptionNumber.trim()) {
    return err("A tax-exempt customer needs the certificate number.");
  }
  if (input.email && !input.email.includes("@")) return err("That email address does not look usable.");
  if (input.paymentTermsDays < 0 || input.paymentTermsDays > 365) return err("Payment terms should be between 0 and 365 days.");
  const key = nameKey(name);
  const sameCode = await tx.party.findUnique({ where: { code } });
  if (sameCode && sameCode.id !== input.id) return err(`ID ${code} is already used by ${sameCode.name}.`);
  const sameName = await tx.party.findUnique({ where: { nameKey: key } });
  if (sameName && sameName.id !== input.id) {
    return err(`“${name}” is already on file as ${sameName.code}. Use that record instead of creating a second one.`);
  }
  const data = {
    code,
    name,
    nameKey: key,
    isCustomer: input.isCustomer,
    isVendor: input.isVendor,
    channel: input.channel,
    contactName: input.contactName.trim(),
    email: input.email.trim(),
    phone: input.phone.trim(),
    billStreet: input.billStreet.trim(),
    billCity: input.billCity.trim(),
    billState,
    billZip: input.billZip.trim(),
    shipStreet: input.shipStreet.trim(),
    shipCity: input.shipCity.trim(),
    shipState,
    shipZip: input.shipZip.trim(),
    taxLocality: input.taxLocality.trim(),
    paymentTermsDays: input.paymentTermsDays,
    creditLimitCents: input.creditLimitCents,
    taxExempt: input.taxExempt,
    exemptionNumber: input.exemptionNumber.trim(),
    exemptionState,
    exemptionExpires: input.exemptionExpires,
    leadTimeDays: input.leadTimeDays,
    notes: input.notes.trim(),
    active: input.active,
    isExample: input.isExample ?? false,
  };
  const saved = input.id
    ? await tx.party.update({ where: { id: input.id }, data })
    : await tx.party.create({ data });
  await audit(tx, actor, input.id ? "update" : "create", "Party", saved.id, `Saved ${saved.code} ${saved.name}`);
  return ok({ id: saved.id });
}

export type ProductInput = {
  id?: string;
  sku: string;
  name: string;
  kind: ProductKind;
  unit: string;
  category: string;
  standardCost: number;
  listPrice: number | null;
  allowOneDollar: boolean;
  sellable: boolean;
  taxable: boolean;
  trackInventory: boolean;
  minQty: number;
  shelfLifeDays: number | null;
  pack: string;
  casNumber: string;
  preferredVendorId: string | null;
  leadTimeDays: number | null;
  nsfCertified: boolean;
  nsfCertNumber: string;
  nsfBody: string;
  nsfUses: string;
  nsfIssuedOn: Date | null;
  nsfExpiresOn: Date | null;
  nsfFormulaVersion: number | null;
  nsfClaim: string;
  ghsSignal: string;
  ghsPictograms: string;
  hazardStatements: string;
  precautionary: string;
  notes: string;
  active: boolean;
  isExample?: boolean;
};

export async function saveProduct(actor: Actor, input: ProductInput): Promise<Result<{ id: string }>> {
  const denied = deny(actor, "editMasters");
  if (denied) return denied;
  return run((tx) => saveProductTx(tx, actor, input));
}

export async function saveProductTx(tx: Tx, actor: Actor, input: ProductInput): Promise<Result<{ id: string }>> {
  const sku = input.sku.trim().toUpperCase();
  const name = input.name.trim();
  if (!validCode(sku)) return err("The SKU should use letters, numbers, and hyphens.");
  if (!name) return err("Enter the product name.");
  if (!input.unit.trim()) return err("Enter the unit, such as lb or gal.");
  if (input.standardCost < 0 || input.minQty < 0) return err("Cost and reorder point cannot be negative.");
  const utility = input.kind === "UTILITY";
  const trackInventory = utility ? false : input.trackInventory;
  const sellable = utility ? false : input.sellable;
  const priceStatus = priceStatusOf(input.listPrice, input.allowOneDollar);
  if (sellable && priceStatus !== "CONFIRMED") {
    return err("A product for sale needs a real selling price. Blank and $1.00 prices are blocked.");
  }
  if (input.nsfCertified) {
    if (!input.nsfCertNumber.trim()) return err("Enter the NSF/ANSI 60 certificate number.");
    if (input.nsfFormulaVersion == null) return err("Enter the certified formula version.");
    if (!input.nsfExpiresOn) return err("Enter the NSF/ANSI 60 expiration date.");
  }
  if (input.preferredVendorId) {
    const vendor = await tx.party.findUnique({ where: { id: input.preferredVendorId } });
    if (!vendor?.isVendor) return err("The preferred supplier must be a supplier already on file.");
  }
  const key = nameKey(name);
  const sameSku = await tx.product.findUnique({ where: { sku } });
  if (sameSku && sameSku.id !== input.id) return err(`SKU ${sku} is already used by ${sameSku.name}.`);
  const sameName = await tx.product.findUnique({ where: { nameKey: key } });
  if (sameName && sameName.id !== input.id) {
    return err(`“${name}” is already on file as ${sameName.sku}. Use that product instead of creating a second one.`);
  }
  if (input.id && utility) {
    const balances = await loadBalances(tx, [input.id]);
    const onHand = balances.reduce((sum, lot) => sum + lot.locations.reduce((inner, row) => inner + row.qty, 0), 0);
    if (onHand > 0.0001) return err("This item still has stock, so it cannot be changed into a utility that is not stored.");
  }
  const data = {
    sku,
    name,
    nameKey: key,
    kind: input.kind,
    unit: input.unit.trim(),
    category: input.category.trim(),
    standardCost: input.standardCost,
    listPrice: priceStatus === "UNSET" ? null : input.listPrice,
    priceStatus,
    allowOneDollar: input.allowOneDollar,
    sellable,
    taxable: input.taxable,
    trackInventory,
    minQty: input.minQty,
    shelfLifeDays: input.shelfLifeDays,
    pack: input.pack.trim(),
    casNumber: input.casNumber.trim(),
    preferredVendorId: input.preferredVendorId,
    leadTimeDays: input.leadTimeDays,
    nsfCertified: input.nsfCertified,
    nsfCertNumber: input.nsfCertNumber.trim(),
    nsfBody: input.nsfBody.trim(),
    nsfUses: input.nsfUses.trim(),
    nsfIssuedOn: input.nsfIssuedOn,
    nsfExpiresOn: input.nsfExpiresOn,
    nsfFormulaVersion: input.nsfFormulaVersion,
    nsfClaim: input.nsfClaim.trim(),
    ghsSignal: input.ghsSignal.trim(),
    ghsPictograms: input.ghsPictograms.trim(),
    hazardStatements: input.hazardStatements.trim(),
    precautionary: input.precautionary.trim(),
    notes: input.notes.trim(),
    active: input.active,
    isExample: input.isExample ?? false,
  };
  const saved = input.id
    ? await tx.product.update({ where: { id: input.id }, data })
    : await tx.product.create({ data });
  await audit(tx, actor, input.id ? "update" : "create", "Product", saved.id, `Saved product ${saved.sku} ${saved.name}`);
  return ok({ id: saved.id });
}

export async function addFormulaVersion(
  actor: Actor,
  input: {
    productId: string;
    batchQty: number;
    notes: string;
    makeDefault: boolean;
    lines: { ingredientId: string; percent: number }[];
  },
): Promise<Result<{ id: string }>> {
  const denied = deny(actor, "editMasters");
  if (denied) return denied;
  return run(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: input.productId } });
    if (!product) return err("That product was not found.");
    if (product.kind !== "FINISHED") return err("Only a finished product has a formula. Raw materials and utilities have a cost instead.");
    if (!(input.batchQty > 0)) return err("Enter a batch size greater than zero.");
    if (input.lines.length === 0) return err("Add at least one ingredient.");
    const seen = new Set<string>();
    for (const line of input.lines) {
      if (!(line.percent > 0)) return err("Every ingredient needs a percent greater than zero.");
      if (line.ingredientId === product.id) return err("A product cannot be an ingredient in its own formula.");
      if (seen.has(line.ingredientId)) return err("Each ingredient can appear only once. Combine the percents.");
      seen.add(line.ingredientId);
    }
    const sum = input.lines.reduce((total, line) => total + line.percent, 0);
    if (Math.abs(sum - 100) >= 0.001) {
      return err(`The ingredients add up to ${sum.toFixed(2)}%. They must add up to 100%.`);
    }
    const products = await tx.product.findMany();
    const formulas = await tx.formula.findMany({ where: { isDefault: true }, include: { lines: true } });
    const costProducts = products.map((item) => ({
      id: item.id,
      sku: item.sku,
      name: item.name,
      kind: item.kind,
      standardCost: Number(item.standardCost),
    }));
    const costFormulas = formulas
      .filter((formula) => formula.productId !== product.id)
      .map((formula) => ({
        productId: formula.productId,
        isDefault: true,
        lines: formula.lines.map((line) => ({ ingredientId: line.ingredientId, percent: Number(line.percent) })),
      }));
    costFormulas.push({
      productId: product.id,
      isDefault: true,
      lines: input.lines.map((line) => ({ ingredientId: line.ingredientId, percent: line.percent })),
    });
    const rolled = rollUpCost(product.id, costProducts, costFormulas);
    if (rolled.problems.some((problem) => /loops/i.test(problem))) return err(rolled.problems[0]);
    const missing = input.lines.filter((line) => !products.some((item) => item.id === line.ingredientId));
    if (missing.length) return err("One of the ingredients is not on the product list.");
    const last = await tx.formula.findFirst({
      where: { productId: product.id },
      orderBy: { version: "desc" },
    });
    const version = (last?.version ?? 0) + 1;
    if (input.makeDefault || !last) {
      await tx.formula.updateMany({ where: { productId: product.id }, data: { isDefault: false } });
    }
    const formula = await tx.formula.create({
      data: {
        productId: product.id,
        version,
        batchQty: input.batchQty,
        isDefault: input.makeDefault || !last,
        notes: input.notes.trim(),
        lines: {
          create: input.lines.map((line, index) => ({
            ingredientId: line.ingredientId,
            percent: line.percent,
            sort: index,
          })),
        },
      },
    });
    await audit(
      tx,
      actor,
      "create",
      "Formula",
      formula.id,
      `Saved formula version ${version} for ${product.sku}. ${rolled.status === "OK" ? `Recipe cost ${rolled.costPerUnit} per ${product.unit}.` : "Recipe cost is not usable yet."}`,
    );
    return ok({ id: formula.id });
  });
}

export async function setDefaultFormula(actor: Actor, formulaId: string): Promise<Result<{ id: string }>> {
  const denied = deny(actor, "editMasters");
  if (denied) return denied;
  return run(async (tx) => {
    const formula = await tx.formula.findUnique({ where: { id: formulaId } });
    if (!formula) return err("That formula was not found.");
    await tx.formula.updateMany({ where: { productId: formula.productId }, data: { isDefault: false } });
    await tx.formula.update({ where: { id: formula.id }, data: { isDefault: true } });
    await audit(tx, actor, "update", "Formula", formula.id, `Made version ${formula.version} the default formula.`);
    return ok({ id: formula.id });
  });
}

export async function replaceSpecs(
  actor: Actor,
  productId: string,
  specs: { parameter: string; unit: string; min: number | null; max: number | null; target: number | null }[],
): Promise<Result<{ count: number }>> {
  const denied = deny(actor, "editMasters");
  if (denied) return denied;
  return run(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product) return err("That product was not found.");
    const clean = specs.filter((spec) => spec.parameter.trim());
    for (const spec of clean) {
      if (spec.min != null && spec.max != null && spec.min > spec.max) {
        return err(`${spec.parameter}: the low end cannot be above the high end.`);
      }
    }
    await tx.qualitySpec.deleteMany({ where: { productId } });
    if (clean.length) {
      await tx.qualitySpec.createMany({
        data: clean.map((spec) => ({
          productId,
          parameter: spec.parameter.trim(),
          unit: spec.unit.trim(),
          min: spec.min,
          max: spec.max,
          target: spec.target,
        })),
      });
    }
    await audit(tx, actor, "update", "Product", productId, `Updated quality checks for ${product.sku}.`);
    return ok({ count: clean.length });
  });
}

export async function addTaxRate(
  actor: Actor,
  input: { state: string; locality: string; name: string; rateBps: number },
): Promise<Result<{ id: string }>> {
  const denied = deny(actor, "postMoney");
  if (denied) return denied;
  return run(async (tx) => {
    const state = input.state.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(state)) return err("State must be two letters.");
    if (!input.name.trim()) return err("Name the tax, such as Florida state sales tax.");
    if (!Number.isInteger(input.rateBps) || input.rateBps < 0 || input.rateBps > 2000) {
      return err("The rate must be between 0% and 20%.");
    }
    const rate = await tx.taxRate.create({
      data: { state, locality: input.locality.trim(), name: input.name.trim(), rateBps: input.rateBps },
    });
    await audit(tx, actor, "create", "TaxRate", rate.id, `Added tax rate ${rate.name}.`);
    return ok({ id: rate.id });
  });
}
