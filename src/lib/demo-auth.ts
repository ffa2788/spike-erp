/** Example sign-in for the demo database only. Change or delete these users before real books. */
export const DEMO_PASSWORD = "example-only-change-me";

export const DEMO_USERS = [
  {
    email: "frank@sper.example",
    name: "FFA",
    role: "OWNER" as const,
    totpSecret: "KWF3ZPUGGKC66FWSLJRYUW4HCPEZZJBC",
  },
  {
    email: "chris@sper.example",
    name: "Chris",
    role: "PARTNER" as const,
    totpSecret: "LF2XI7OMRHPZRQPRLIJDFC3PBKWIPM7O",
  },
];
