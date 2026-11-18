import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { formatSequence, takeNumber } from "@/lib/services/shared";

describe("invoice numbers", () => {
  it("is gapless when a transaction rolls back and does not hand two callers the same number", async () => {
    await prisma.numberSequence.upsert({
      where: { name: "numtest" },
      update: { next: 1 },
      create: { name: "numtest", next: 1 },
    });
    await expect(
      prisma.$transaction(async (tx) => {
        await takeNumber(tx, "numtest");
        throw new Error("rollback");
      }),
    ).rejects.toThrow(/rollback/);
    const afterRollback = await prisma.$transaction((tx) => takeNumber(tx, "numtest"));
    expect(afterRollback).toBe(1);
    expect(formatSequence("invoice-S", afterRollback)).toBe("S-000001");

    await prisma.numberSequence.update({ where: { name: "numtest" }, data: { next: 1 } });
    const [first, second] = await Promise.all([
      prisma.$transaction((tx) => takeNumber(tx, "numtest")),
      prisma.$transaction((tx) => takeNumber(tx, "numtest")),
    ]);
    expect([first, second].sort((a, b) => a - b)).toEqual([1, 2]);
    const third = await prisma.$transaction((tx) => takeNumber(tx, "numtest"));
    expect(third).toBe(3);
    expect(formatSequence("invoice-A", 1)).toBe("A-000001");
    expect(formatSequence("invoice-W", 2)).toBe("W-000002");
    expect(formatSequence("invoice-E", 3)).toBe("E-000003");
    expect(formatSequence("invoice-W", 1)).toBe("W-000001");
    expect(formatSequence("invoice-S", 1)).not.toBe(formatSequence("invoice-A", 1));
  });
});
