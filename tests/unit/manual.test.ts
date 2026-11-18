import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyHelpAnswer, helpBack, helpNotice } from "@/lib/help";
import {
  HOW_DO_I,
  REQUIRED_ANCHORS,
  blocksOf,
  botManualResult,
  mayEditManual,
  missingAnchors,
  parseManual,
  searchManual,
  sectionForScreen,
} from "@/lib/manual";

const markdown = readFileSync("docs/OPERATING-MANUAL.md", "utf8");

describe("operating manual", () => {
  const doc = parseManual(markdown);

  it("keeps an anchor on every section the help panel links to", () => {
    expect(missingAnchors(markdown)).toEqual([]);
    const ids = new Set(doc.sections.map((section) => section.id));
    for (const anchor of REQUIRED_ANCHORS) expect(ids.has(anchor)).toBe(true);
    expect(HOW_DO_I).toHaveLength(10);
    for (const item of HOW_DO_I) expect(ids.has(item.anchor)).toBe(true);
  });

  it("numbers the Amazon week steps and keeps the bot rules in plain words", () => {
    const week = doc.sections.find((section) => section.id === "amazon-week");
    const steps = blocksOf(week?.body ?? "").find((block) => block.type === "ol");
    expect(steps && steps.type === "ol" ? steps.items.length : 0).toBeGreaterThanOrEqual(4);
    const rules = doc.sections.find((section) => section.id === "bot-permissions")?.body ?? "";
    expect(rules).toMatch(/Can do alone/);
    expect(rules).toMatch(/Needs FFA approval/);
    expect(rules).toMatch(/unless the sender's email matches the customer record/);
    expect(rules).toMatch(/cannot change it/);
  });

  it("searches by the words Chris would type", () => {
    const deposit = searchManual(doc.sections, "Truist");
    expect(deposit.some((hit) => hit.id === "amazon-week" || hit.id === "deposit-mismatch")).toBe(true);
    expect(searchManual(doc.sections, "void").some((hit) => hit.id === "wrong-invoice")).toBe(true);
    expect(searchManual(doc.sections, "a")).toEqual([]);
  });

  it("opens the manual section for the screen Chris is on", () => {
    expect(sectionForScreen("/sales", "week")).toBe("amazon-week");
    expect(sectionForScreen("/sales", "walmart")).toBe("walmart");
    expect(sectionForScreen("/purchasing", "bills")).toBe("pay-a-bill");
    expect(sectionForScreen("/inventory", "coverage")).toBe("low-stock");
    expect(sectionForScreen("/money", "bank")).toBe("deposit-mismatch");
    expect(sectionForScreen("/", "")).toBe("who-does-what");
  });

  it("lets only the owner edit, and lets the bot only read", () => {
    expect(mayEditManual("OWNER")).toBe(true);
    expect(mayEditManual("PARTNER")).toBe(false);
    expect(mayEditManual("READONLY")).toBe(false);
    expect(botManualResult("GET")).toBe("read");
    expect(botManualResult("POST")).toBe("refuse");
    expect(botManualResult("PUT")).toBe("refuse");
    expect(botManualResult("PATCH")).toBe("refuse");
    expect(botManualResult("DELETE")).toBe("refuse");
  });
});

describe("help requests", () => {
  it("rejects an empty answer and a closed request", () => {
    expect(applyHelpAnswer("open", "  ")).toEqual({ ok: false, error: "Write an answer." });
    expect(applyHelpAnswer("closed", "Done.")).toEqual({ ok: false, error: "This request is closed." });
    expect(applyHelpAnswer("open", "Void it and reissue. Do not delete it.")).toEqual({ ok: true });
    expect(applyHelpAnswer("answered", "A clearer answer.")).toEqual({ ok: true });
  });

  it("writes FFA a note with the screen and the message", () => {
    const note = helpNotice({
      fromName: "Chris",
      screen: "/sales?tab=week",
      recordRef: "",
      message: "The deposit is off by 12 cents.",
      ownerEmail: "frank@sper.example",
    });
    expect(note).toMatchObject({ to: ["frank@sper.example"], subject: "Help request from Chris" });
    if ("text" in note) {
      expect(note.text).toContain("/sales?tab=week");
      expect(note.text).toContain("12 cents");
    }
    expect(helpNotice({ fromName: "Chris", screen: "/", recordRef: "", message: "Help", ownerEmail: null })).toEqual({
      skip: "No owner email is on file.",
    });
  });

  it("returns to the same screen with Help open", () => {
    expect(helpBack("/sales?tab=week")).toBe("/sales?tab=week&help=1");
    expect(helpBack("https://evil.example")).toBe("/?help=1");
  });
});
