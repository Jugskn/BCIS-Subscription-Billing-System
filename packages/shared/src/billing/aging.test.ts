import { describe, expect, it } from "vitest";
import {
  assignAgingBucket,
  computeArAging,
  daysPastDue,
} from "./aging.js";

describe("AR aging", () => {
  it("assigns buckets by days past due+grace", () => {
    expect(daysPastDue("2026-01-01", 5, "2026-01-06")).toBe(0);
    expect(daysPastDue("2026-01-01", 5, "2026-01-07")).toBe(1);
    expect(assignAgingBucket(0)).toBe("Current");
    expect(assignAgingBucket(15)).toBe("1-30");
    expect(assignAgingBucket(45)).toBe("31-60");
    expect(assignAgingBucket(75)).toBe("61-90");
    expect(assignAgingBucket(120)).toBe("90+");
  });

  it("total equals sum of open balances across buckets", () => {
    const summary = computeArAging(
      [
        { balanceCentavos: 100_00n, dueDate: "2026-09-01" }, // overdue
        { balanceCentavos: 200_00n, dueDate: "2026-10-10" }, // current if today 2026-10-07 + grace
        { balanceCentavos: 50_00n, dueDate: "2026-07-01" }, // 90+
        { balanceCentavos: 0n, dueDate: "2026-01-01" }, // skipped
      ],
      5,
      "2026-10-07",
    );

    const bucketSum = summary.buckets.reduce(
      (s, b) => s + b.balanceCentavos,
      0n,
    );
    expect(summary.totalBalanceCentavos).toBe(350_00n);
    expect(bucketSum).toBe(summary.totalBalanceCentavos);
    expect(summary.totalInvoiceCount).toBe(3);
  });
});
