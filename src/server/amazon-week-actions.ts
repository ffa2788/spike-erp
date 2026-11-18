"use server";

import { confirmAssemblies, matchAmazonDeposit } from "@/lib/services/amazon-week";
import { requireCan } from "./actor";
import { fail, succeed } from "./http";

export async function confirmAssembliesAction() {
  const actor = await requireCan("produce");
  const result = await confirmAssemblies(actor);
  if (!result.ok) fail("/sales?tab=week", result.error);
  succeed("/sales?tab=week", `Confirmed ${result.value.confirmed} assemblies.`);
}

export async function matchDepositAction(formData: FormData) {
  const actor = await requireCan("postMoney");
  const result = await matchAmazonDeposit(actor, {
    statementLineId: String(formData.get("statementLineId") ?? ""),
    settlementId: String(formData.get("settlementId") ?? ""),
  });
  if (!result.ok) fail("/sales?tab=week", result.error);
  succeed("/sales?tab=week", `Matched the Truist deposit of ${(result.value.cents / 100).toFixed(2)} to the penny.`);
}
