export type RoleName = "OWNER" | "PARTNER" | "WAREHOUSE" | "READONLY";

export type Action =
  | "view"
  | "editMasters"
  | "sell"
  | "ship"
  | "receive"
  | "produce"
  | "releaseQc"
  | "postMoney"
  | "importData"
  | "manageUsers"
  | "manualJournal";

const MATRIX: Record<RoleName, Action[]> = {
  OWNER: [
    "view",
    "editMasters",
    "sell",
    "ship",
    "receive",
    "produce",
    "releaseQc",
    "postMoney",
    "importData",
    "manageUsers",
    "manualJournal",
  ],
  PARTNER: [
    "view",
    "editMasters",
    "sell",
    "ship",
    "receive",
    "produce",
    "releaseQc",
    "postMoney",
    "importData",
    "manualJournal",
  ],
  WAREHOUSE: ["view", "ship", "receive", "produce"],
  READONLY: ["view"],
};

export function can(role: RoleName, action: Action): boolean {
  return MATRIX[role].includes(action);
}

export const ROLE_LABEL: Record<RoleName, string> = {
  OWNER: "Owner",
  PARTNER: "Office",
  WAREHOUSE: "Manufacturing",
  READONLY: "Read only",
};
