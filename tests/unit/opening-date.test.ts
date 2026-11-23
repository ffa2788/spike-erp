import { describe, expect, it } from "vitest";
import { dateInHeader, resolveOpeningDate, withoutPreamble } from "@/lib/opening-date";
import { closedPeriodProblem, snapshotOpening, totalsChanged, totalsProblem } from "@/lib/redate-opening";

const today = "2026-11-23";
const trial = "Account ID,Debit,Credit\n1100,1.00,\n3900,,1.00\n";

describe("opening as-of date", () => {
  it("reads the date above the column headers and uses a typed date first", () => {
    const file = `Sage 50 Trial Balance\nAs of October 31, 2026\n${trial}`;
    expect(dateInHeader(file)).toBe("2026-10-31");
    expect(withoutPreamble(file).startsWith("Account ID")).toBe(true);
    expect(resolveOpeningDate({ files: [file], today })).toEqual({ ok: true, date: "2026-10-31" });
    expect(resolveOpeningDate({ asOf: "2026-10-15", files: [file], today })).toEqual({ ok: true, date: "2026-10-15" });
  });

  it("requires a date for the opening trial and stock count and rejects a future day", () => {
    expect(resolveOpeningDate({ files: [trial], today })).toEqual({
      ok: false,
      error: "Choose the as-of date for the opening trial balance and stock count.",
    });
    expect(resolveOpeningDate({ asOf: "2026-11-24", today }).ok).toBe(false);
    expect(resolveOpeningDate({ asOf: "2026-11-23", today })).toEqual({ ok: true, date: "2026-11-23" });
    expect(resolveOpeningDate({ asOf: "11/01/2026", today })).toEqual({ ok: true, date: "2026-11-01" });
  });

  it("keeps the opening totals and refuses a closed period", () => {
    const lines = [
      { accountCode: "1100", debitCents: 33_608_758, creditCents: 0 },
      { accountCode: "1200", debitCents: 50_547_979, creditCents: 0 },
      { accountCode: "2000", debitCents: 0, creditCents: 2_428_677 },
      { accountCode: "1991", debitCents: 0, creditCents: 1_702_616 },
      { accountCode: "1992", debitCents: 947_549, creditCents: 0 },
      { accountCode: "1993", debitCents: 140_034, creditCents: 0 },
      { accountCode: "3900", debitCents: 0, creditCents: 81_113_027 },
    ];
    const snapshot = snapshotOpening({ journalLines: lines, lots: [{ qty: 100, unitCost: 1854.3537 }] });
    expect(snapshot.trialDebit).toBe(snapshot.trialCredit);
    expect(totalsProblem(snapshot)).toBeNull();
    expect(totalsChanged(snapshot, snapshot)).toBe(false);
    const moved = snapshotOpening({ journalLines: lines.map((line) => ({ ...line, debitCents: line.debitCents + (line.accountCode === "1100" ? 1 : 0) })), lots: [{ qty: 100, unitCost: 1854.3537 }] });
    expect(totalsChanged(snapshot, moved)).toBe(true);
    expect(closedPeriodProblem(["2026-11-23"], "2026-10-31", "2026-10-31")).toMatch(/closed period/);
    expect(closedPeriodProblem(["2026-11-23"], null, "2026-10-31")).toBeNull();
    expect(closedPeriodProblem(["2026-11-23"], "2026-09-30", "2026-10-31")).toBeNull();
  });
});
