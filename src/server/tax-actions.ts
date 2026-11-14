"use server";

import { CODES } from "@/lib/chart";
import { parseDateInput } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { postManualJournal } from "@/lib/services/money";
import { requireCan } from "./actor";
import { fail, succeed } from "./http";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function setEntityType(formData: FormData) {
  await requireCan("editMasters");
  const entity = text(formData, "entityType") === "C_CORP" ? "C_CORP" : "S_CORP";
  await prisma.companyProfile.update({ where: { id: "company" }, data: { entityType: entity } });
  succeed("/tax", entity === "C_CORP" ? "Set to a C corporation, Form 1120." : "Set to an S corporation, Form 1120-S.");
}

export async function addFixedAsset(formData: FormData) {
  const actor = await requireCan("manualJournal");
  const description = text(formData, "description");
  const placed = parseDateInput(text(formData, "placedInService"));
  const dollars = Number(text(formData, "cost").replace(/[$,]/g, ""));
  if (description.length < 3) fail("/tax", "Name the equipment.");
  if (!placed) fail("/tax", "Enter the date you started using it.");
  if (!Number.isFinite(dollars) || dollars <= 0) fail("/tax", "Enter the cost.");
  const costCents = Math.round(dollars * 100);
  const journal = await postManualJournal(actor, {
    date: placed,
    memo: description,
    lines: [
      { accountCode: CODES.equipment, debitCents: costCents, creditCents: 0, memo: description },
      { accountCode: CODES.cash, debitCents: 0, creditCents: costCents, memo: "Paid for equipment" },
    ],
  });
  if (!journal.ok) fail("/tax", journal.error);
  await prisma.fixedAsset.create({
    data: {
      description,
      placedInService: placed,
      costCents,
      section179Candidate: formData.get("candidate") === "yes",
      notes: "Entered from the Tax Center. Paid from cash.",
    },
  });
  succeed("/tax", "Equipment added to the list and to the equipment account. Cash went down.");
}
