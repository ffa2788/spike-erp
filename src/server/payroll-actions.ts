"use server";

import { parseDollars, parseQty } from "@/lib/pricing";
import { createPayRun, postPayRun, reviewPayrollTable, savePayrollTable } from "@/lib/services/payroll-run";
import { requireCan } from "./actor";
import { fail, succeed } from "./http";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function saveTaxTableAction(formData: FormData) {
  await requireCan("postMoney");
  const percent = (name: string) => Math.round((parseDollars(text(formData, name)) ?? 0) * 100);
  const dollars = (name: string) => Math.round((parseDollars(text(formData, name)) ?? 0) * 100);
  await savePayrollTable({
    reviewed: false,
    socialSecurityBps: percent("socialSecurity"),
    socialSecurityWageBaseCents: dollars("socialSecurityBase"),
    medicareBps: percent("medicare"),
    futaBps: percent("futa"),
    futaWageBaseCents: dollars("futaBase"),
    floridaBps: percent("florida"),
    floridaWageBaseCents: dollars("floridaBase"),
    note: "Example rates. The accountant must review this table before a calculated pay run can be posted. SPIKE does not file payroll taxes.",
  });
  succeed("/payroll", "Tax table saved. It is marked not reviewed until the accountant confirms it.");
}

export async function reviewTaxTableAction(formData: FormData) {
  await requireCan("postMoney");
  await reviewPayrollTable(formData.get("reviewed") === "yes");
  succeed("/payroll", formData.get("reviewed") === "yes" ? "The accountant marked the tax table reviewed. Calculated pay runs can be posted. This is still not a filing." : "The tax table is not reviewed.");
}

export async function createPayRunAction(formData: FormData) {
  const actor = await requireCan("postMoney");
  const mode = text(formData, "mode") === "PROVIDER" ? "PROVIDER" : "CALCULATOR";
  const ids = formData.getAll("employeeId").map(String);
  const lines = ids.map((employeeId) => ({
    employeeId,
    hours: parseQty(text(formData, `hours-${employeeId}`)) ?? 0,
    grossCents: Math.round((parseDollars(text(formData, `gross-${employeeId}`)) ?? 0) * 100),
    entered: mode === "PROVIDER" ? {
      federalWithholdingCents: Math.round((parseDollars(text(formData, `wh-${employeeId}`)) ?? 0) * 100),
      socialSecurityCents: Math.round((parseDollars(text(formData, `ss-${employeeId}`)) ?? 0) * 100),
      medicareCents: Math.round((parseDollars(text(formData, `med-${employeeId}`)) ?? 0) * 100),
      futaCents: Math.round((parseDollars(text(formData, `futa-${employeeId}`)) ?? 0) * 100),
      floridaCents: Math.round((parseDollars(text(formData, `fl-${employeeId}`)) ?? 0) * 100),
    } : undefined,
  }));
  const result = await createPayRun(actor, {
    periodStart: text(formData, "periodStart"),
    periodEnd: text(formData, "periodEnd"),
    payDate: text(formData, "payDate"),
    mode,
    lines,
  });
  if (!result.ok) fail("/payroll", result.error);
  succeed(`/payroll/runs/${result.value.id}`, mode === "PROVIDER" ? "Pay run saved from the provider's amounts." : "Pay run calculated. Review it before posting.");
}

export async function postPayRunAction(formData: FormData) {
  const actor = await requireCan("postMoney");
  const id = text(formData, "id");
  const result = await postPayRun(actor, id);
  if (!result.ok) fail(`/payroll/runs/${id}`, result.error);
  succeed(`/payroll/runs/${id}`, "Pay run posted to the books.");
}
