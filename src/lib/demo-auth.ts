/** Example sign-in for the demo database only. Change or delete these users before real books. */
export const DEMO_PASSWORD = "example-only-change-me";

export const DEMO_USERS = [
  {
    email: "frank@sper.example",
    name: "Frank Abbott",
    role: "OWNER" as const,
    totpSecret: "KWF3ZPUGGKC66FWSLJRYUW4HCPEZZJBC",
  },
  {
    email: "partner@sper.example",
    name: "Business Partner",
    role: "PARTNER" as const,
    totpSecret: "LF2XI7OMRHPZRQPRLIJDFC3PBKWIPM7O",
  },
  {
    email: "warehouse@sper.example",
    name: "Warehouse Lead",
    role: "WAREHOUSE" as const,
    totpSecret: "35HHBJMQDFOXMDSFGM5NNM7Y5EGAJUH5",
  },
  {
    email: "readonly@sper.example",
    name: "Read Only",
    role: "READONLY" as const,
    totpSecret: "7KPYKR3E24UGXPZSUKG7H62Q3XIF3UTR",
  },
];
