import { describe, expect, it } from "vitest";
import { pesosToCentavos } from "../money.js";
import {
  allocateManual,
  allocateOldestFirst,
  previewAllocation,
  sortInvoicesOldestFirst,
} from "./allocation.js";

const inv = (
  id: string,
  invoiceNumber: string,
  balancePesos: string,
  sortDate: string,
  billingPeriod?: string,
) => ({
  id,
  invoiceNumber,
  balanceCentavos: pesosToCentavos(balancePesos),
  sortDate,
  billingPeriod,
});

describe("AT-01 exact payment", () => {
  it("Invoice 999; pay 999 → remaining 0; PAID; no credit", () => {
    const result = allocateOldestFirst(pesosToCentavos("999"), [
      inv("i1", "INV-000001", "999", "2025-08-15", "2025-08"),
    ]);

    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0]!.allocatedCentavos).toBe(pesosToCentavos("999"));
    expect(result.allocations[0]!.remainingBalanceCentavos).toBe(0n);
    expect(result.allocations[0]!.resultingStatus).toBe("PAID");
    expect(result.unallocatedCentavos).toBe(0n);
    expect(result.totalAllocatedCentavos).toBe(pesosToCentavos("999"));
  });
});

describe("AT-02 partial payment", () => {
  it("Invoice 999; pay 500 → remaining 499; PARTIALLY_PAID", () => {
    const result = allocateOldestFirst(pesosToCentavos("500"), [
      inv("i1", "INV-000001", "999", "2025-08-15", "2025-08"),
    ]);

    expect(result.allocations[0]!.allocatedCentavos).toBe(pesosToCentavos("500"));
    expect(result.allocations[0]!.remainingBalanceCentavos).toBe(
      pesosToCentavos("499"),
    );
    expect(result.allocations[0]!.resultingStatus).toBe("PARTIALLY_PAID");
    expect(result.unallocatedCentavos).toBe(0n);
  });
});

describe("AT-03 advance payment", () => {
  it("Monthly 1,000; pay 3,000 → allocate 1,000; credit 2,000 (no value lost)", () => {
    const payment = pesosToCentavos("3000");
    const result = allocateOldestFirst(payment, [
      inv("i1", "INV-000001", "1000", "2025-10-15", "2025-10"),
    ]);

    expect(result.totalAllocatedCentavos).toBe(pesosToCentavos("1000"));
    expect(result.unallocatedCentavos).toBe(pesosToCentavos("2000"));
    expect(result.allocations[0]!.resultingStatus).toBe("PAID");
    expect(
      result.totalAllocatedCentavos + result.unallocatedCentavos,
    ).toBe(payment);
  });

  it("advance with no open invoices becomes full credit", () => {
    const payment = pesosToCentavos("500");
    const result = allocateOldestFirst(payment, []);
    expect(result.allocations).toHaveLength(0);
    expect(result.unallocatedCentavos).toBe(payment);
    expect(result.totalAllocatedCentavos).toBe(0n);
  });
});

describe("AT-04 oldest-first arrears", () => {
  it("Aug 999 + Sep 999; pay 1,200 → Aug 0; Sep 798 remaining", () => {
    const result = allocateOldestFirst(pesosToCentavos("1200"), [
      inv("sep", "INV-000002", "999", "2025-09-15", "2025-09"),
      inv("aug", "INV-000001", "999", "2025-08-15", "2025-08"),
    ]);

    expect(result.allocations).toHaveLength(2);
    expect(result.allocations[0]!.invoiceId).toBe("aug");
    expect(result.allocations[0]!.remainingBalanceCentavos).toBe(0n);
    expect(result.allocations[0]!.resultingStatus).toBe("PAID");
    expect(result.allocations[1]!.invoiceId).toBe("sep");
    expect(result.allocations[1]!.allocatedCentavos).toBe(pesosToCentavos("201"));
    expect(result.allocations[1]!.remainingBalanceCentavos).toBe(
      pesosToCentavos("798"),
    );
    expect(result.allocations[1]!.resultingStatus).toBe("PARTIALLY_PAID");
    expect(result.unallocatedCentavos).toBe(0n);
  });
});

describe("sort and manual allocation", () => {
  it("sortInvoicesOldestFirst orders by date then number", () => {
    const sorted = sortInvoicesOldestFirst([
      inv("b", "INV-000002", "100", "2025-09-01", "2025-09"),
      inv("a", "INV-000001", "100", "2025-08-01", "2025-08"),
    ]);
    expect(sorted.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("manual allocation respects specified amounts and leftover credit", () => {
    const invoices = [
      inv("aug", "INV-000001", "999", "2025-08-15", "2025-08"),
      inv("sep", "INV-000002", "999", "2025-09-15", "2025-09"),
    ];
    const result = allocateManual(pesosToCentavos("1500"), invoices, [
      { invoiceId: "sep", amountCentavos: pesosToCentavos("999") },
      { invoiceId: "aug", amountCentavos: pesosToCentavos("200") },
    ]);

    expect(result.allocations[0]!.invoiceId).toBe("sep");
    expect(result.allocations[0]!.resultingStatus).toBe("PAID");
    expect(result.allocations[1]!.remainingBalanceCentavos).toBe(
      pesosToCentavos("799"),
    );
    expect(result.unallocatedCentavos).toBe(pesosToCentavos("301"));
  });

  it("manual allocation rejects over-allocation", () => {
    expect(() =>
      allocateManual(
        pesosToCentavos("100"),
        [inv("i1", "INV-1", "999", "2025-08-01")],
        [{ invoiceId: "i1", amountCentavos: pesosToCentavos("200") }],
      ),
    ).toThrow(/exceed/i);
  });

  it("previewAllocation uses oldest-first when no manual lines", () => {
    const result = previewAllocation(pesosToCentavos("100"), [
      inv("i1", "INV-1", "999", "2025-08-01"),
    ]);
    expect(result.allocations[0]!.allocatedCentavos).toBe(pesosToCentavos("100"));
  });
});
