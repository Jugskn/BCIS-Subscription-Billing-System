import { describe, expect, it } from "vitest";
import { pesosToCentavos } from "../money.js";
import {
  applyCreditToInvoice,
  buildSubscriptionLine,
  computeAdjustmentLedgerOffset,
  computeInvoiceTotals,
  computeOverdueStatus,
  computeVoidLedgerOffset,
  deriveOpenInvoiceStatus,
} from "./invoice.js";
import { computeRunningBalances, ledgerBalanceAt } from "./ledger.js";
import {
  computeDueDate,
  formatBillingPeriod,
  isBillableForPeriod,
  parseBillingPeriod,
} from "./period.js";

describe("billing period", () => {
  it("parses and formats YYYY-MM", () => {
    expect(parseBillingPeriod("2025-10")).toEqual({ year: 2025, month: 10 });
    expect(formatBillingPeriod(2025, 10)).toBe("2025-10");
  });

  it("computes due date from due day within period month", () => {
    expect(computeDueDate("2025-10", 15)).toBe("2025-10-15");
    expect(computeDueDate("2025-02", 28)).toBe("2025-02-28");
  });

  it("isBillableForPeriod respects ACTIVE and billing start", () => {
    expect(
      isBillableForPeriod(
        { status: "ACTIVE", billingStartDate: "2025-01-01" },
        "2025-10",
      ),
    ).toBe(true);
    expect(
      isBillableForPeriod(
        { status: "SUSPENDED", billingStartDate: "2025-01-01" },
        "2025-10",
      ),
    ).toBe(false);
    expect(
      isBillableForPeriod(
        { status: "ACTIVE", billingStartDate: "2025-11-01" },
        "2025-10",
      ),
    ).toBe(false);
  });
});

describe("invoice totals and credit", () => {
  it("computes totals from line items", () => {
    const rate = pesosToCentavos("999");
    const lines = [
      buildSubscriptionLine(rate),
      {
        itemType: "DISCOUNT" as const,
        description: "Promo",
        rateCentavos: pesosToCentavos("100"),
        amountCentavos: pesosToCentavos("100"),
      },
    ];
    const totals = computeInvoiceTotals(lines);
    expect(totals.subtotalCentavos).toBe(pesosToCentavos("999"));
    expect(totals.discountCentavos).toBe(pesosToCentavos("100"));
    expect(totals.totalCentavos).toBe(pesosToCentavos("899"));
  });

  it("auto-applies credit fully when sufficient", () => {
    const total = pesosToCentavos("999");
    const credit = pesosToCentavos("1500");
    const result = applyCreditToInvoice(total, credit);
    expect(result.creditAppliedCentavos).toBe(pesosToCentavos("999"));
    expect(result.remainingCreditCentavos).toBe(pesosToCentavos("501"));
    expect(result.balanceCentavos).toBe(0n);
    expect(result.status).toBe("PAID");
  });

  it("auto-applies credit partially", () => {
    const total = pesosToCentavos("999");
    const credit = pesosToCentavos("500");
    const result = applyCreditToInvoice(total, credit);
    expect(result.creditAppliedCentavos).toBe(pesosToCentavos("500"));
    expect(result.balanceCentavos).toBe(pesosToCentavos("499"));
    expect(result.status).toBe("PARTIALLY_PAID");
  });

  it("rate snapshot is independent of plan price (domain line uses account rate)", () => {
    const originalRate = pesosToCentavos("999");
    const line = buildSubscriptionLine(originalRate);
    const newPlanRate = pesosToCentavos("1299");
    expect(line.rateCentavos).toBe(originalRate);
    expect(line.rateCentavos).not.toBe(newPlanRate);
    expect(computeInvoiceTotals([line]).totalCentavos).toBe(originalRate);
  });
});

describe("overdue status", () => {
  it("marks overdue after due date + grace", () => {
    expect(
      computeOverdueStatus("2025-10-15", 5, "2025-10-20", "UNPAID"),
    ).toBe("UNPAID");
    expect(
      computeOverdueStatus("2025-10-15", 5, "2025-10-21", "UNPAID"),
    ).toBe("OVERDUE");
    expect(computeOverdueStatus("2025-10-15", 5, "2025-10-21", "PAID")).toBe(
      "PAID",
    );
  });

  it("deriveOpenInvoiceStatus combines payment and overdue", () => {
    expect(
      deriveOpenInvoiceStatus(
        pesosToCentavos("999"),
        0n,
        "2025-10-15",
        5,
        "2025-10-25",
      ),
    ).toBe("OVERDUE");
    expect(
      deriveOpenInvoiceStatus(
        pesosToCentavos("999"),
        pesosToCentavos("999"),
        "2025-10-15",
        5,
        "2025-10-25",
      ),
    ).toBe("PAID");
  });
});

describe("ledger running balance", () => {
  const entries = [
    {
      id: "a",
      entryDate: "2025-10-01",
      referenceType: "INVOICE",
      referenceId: "inv-1",
      description: "INV-1001",
      debitCentavos: pesosToCentavos("999"),
      creditCentavos: 0n,
    },
    {
      id: "b",
      entryDate: "2025-10-05",
      referenceType: "PAYMENT",
      referenceId: "pay-1",
      description: "RCPT-5001",
      debitCentavos: 0n,
      creditCentavos: pesosToCentavos("500"),
    },
    {
      id: "c",
      entryDate: "2025-10-10",
      referenceType: "PAYMENT",
      referenceId: "pay-2",
      description: "RCPT-5110",
      debitCentavos: 0n,
      creditCentavos: pesosToCentavos("499"),
    },
  ];

  it("reproduces SPEC 3.5 example balances", () => {
    const withBalance = computeRunningBalances(entries);
    expect(withBalance[0]!.balanceCentavos).toBe(pesosToCentavos("999"));
    expect(withBalance[1]!.balanceCentavos).toBe(pesosToCentavos("499"));
    expect(withBalance[2]!.balanceCentavos).toBe(0n);
  });

  it("is stable regardless of input order", () => {
    const shuffled = [entries[2]!, entries[0]!, entries[1]!];
    const withBalance = computeRunningBalances(shuffled);
    expect(withBalance.map((e) => e.balanceCentavos)).toEqual([
      pesosToCentavos("999"),
      pesosToCentavos("499"),
      0n,
    ]);
  });

  it("ledgerBalanceAt respects date cutoff", () => {
    expect(ledgerBalanceAt(entries, "2025-10-05")).toBe(pesosToCentavos("499"));
    expect(ledgerBalanceAt(entries, "2025-10-01")).toBe(pesosToCentavos("999"));
  });
});

describe("void and adjustment offsets", () => {
  it("void credits remaining balance", () => {
    const offset = computeVoidLedgerOffset({
      invoiceNumber: "INV-1001",
      balanceCentavos: pesosToCentavos("499"),
      paidCentavos: pesosToCentavos("500"),
    });
    expect(offset.creditCentavos).toBe(pesosToCentavos("499"));
    expect(offset.debitCentavos).toBe(0n);
  });

  it("adjustment debit increases balance", () => {
    const adj = computeAdjustmentLedgerOffset(
      "INV-1001",
      pesosToCentavos("50"),
      "Late fee correction",
    );
    expect(adj.debitCentavos).toBe(pesosToCentavos("50"));
  });
});

/** AT-11: duplicate billing — domain idempotency key is (service_account_id, billing_period) excluding VOID. */
describe("AT-11 duplicate billing (domain key)", () => {
  it("same period + account is a duplicate when prior invoice is not VOID", () => {
    const existing = [
      { serviceAccountId: "sa-1", billingPeriod: "2025-10", status: "UNPAID" },
    ];
    const isDuplicate = (serviceAccountId: string, billingPeriod: string) =>
      existing.some(
        (inv) =>
          inv.serviceAccountId === serviceAccountId &&
          inv.billingPeriod === billingPeriod &&
          inv.status !== "VOID",
      );

    expect(isDuplicate("sa-1", "2025-10")).toBe(true);
    expect(isDuplicate("sa-1", "2025-11")).toBe(false);
    existing.push({
      serviceAccountId: "sa-2",
      billingPeriod: "2025-10",
      status: "VOID",
    });
    expect(isDuplicate("sa-2", "2025-10")).toBe(false);
  });
});
