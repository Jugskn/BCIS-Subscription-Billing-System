import type { InvoiceStatus } from "./invoice.js";

export const PAYMENT_METHODS = [
  "Cash",
  "GCash",
  "BankTransfer",
  "Cheque",
  "Other",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = [
  "POSTED",
  "PENDING",
  "VERIFIED",
  "REJECTED",
  "REVERSED",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const RECEIPT_STATUSES = ["ISSUED", "VOID"] as const;

export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

/** Open invoice eligible for allocation (balance > 0). */
export type AllocatableInvoice = {
  id: string;
  invoiceNumber: string;
  balanceCentavos: bigint;
  /** ISO date used for oldest-first ordering (due date or billing period start). */
  sortDate: string;
  billingPeriod?: string;
};

export type ManualAllocationInput = {
  invoiceId: string;
  amountCentavos: bigint;
};

export type AllocationLine = {
  invoiceId: string;
  invoiceNumber: string;
  allocatedCentavos: bigint;
  previousBalanceCentavos: bigint;
  remainingBalanceCentavos: bigint;
  /** Status from payment alone (ignores overdue; service may re-derive). */
  resultingStatus: Extract<
    InvoiceStatus,
    "PAID" | "PARTIALLY_PAID" | "UNPAID"
  >;
};

export type AllocationResult = {
  allocations: AllocationLine[];
  totalAllocatedCentavos: bigint;
  /** Remainder becomes unapplied subscriber credit (advance). */
  unallocatedCentavos: bigint;
};

function statusAfterPay(
  previousBalance: bigint,
  allocated: bigint,
): AllocationLine["resultingStatus"] {
  const remaining = previousBalance - allocated;
  if (remaining <= 0n) return "PAID";
  if (allocated > 0n) return "PARTIALLY_PAID";
  return "UNPAID";
}

function assertPositivePayment(paymentCentavos: bigint): void {
  if (paymentCentavos <= 0n) {
    throw new Error("Payment amount must be greater than zero.");
  }
}

/** Oldest unpaid first: sort by sortDate ASC, then invoiceNumber ASC. */
export function sortInvoicesOldestFirst(
  invoices: AllocatableInvoice[],
): AllocatableInvoice[] {
  return [...invoices].sort((a, b) => {
    if (a.sortDate !== b.sortDate) {
      return a.sortDate < b.sortDate ? -1 : 1;
    }
    if (a.billingPeriod && b.billingPeriod && a.billingPeriod !== b.billingPeriod) {
      return a.billingPeriod < b.billingPeriod ? -1 : 1;
    }
    return a.invoiceNumber < b.invoiceNumber
      ? -1
      : a.invoiceNumber > b.invoiceNumber
        ? 1
        : 0;
  });
}

/**
 * Default policy: allocate payment to open invoices oldest-first.
 * Leftover after all balances are covered becomes unallocated credit.
 */
export function allocateOldestFirst(
  paymentCentavos: bigint,
  invoices: AllocatableInvoice[],
): AllocationResult {
  assertPositivePayment(paymentCentavos);

  const ordered = sortInvoicesOldestFirst(
    invoices.filter((inv) => inv.balanceCentavos > 0n),
  );

  let remaining = paymentCentavos;
  const allocations: AllocationLine[] = [];

  for (const inv of ordered) {
    if (remaining <= 0n) break;
    const allocated =
      remaining >= inv.balanceCentavos ? inv.balanceCentavos : remaining;
    if (allocated <= 0n) continue;

    allocations.push({
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      allocatedCentavos: allocated,
      previousBalanceCentavos: inv.balanceCentavos,
      remainingBalanceCentavos: inv.balanceCentavos - allocated,
      resultingStatus: statusAfterPay(inv.balanceCentavos, allocated),
    });
    remaining -= allocated;
  }

  return {
    allocations,
    totalAllocatedCentavos: paymentCentavos - remaining,
    unallocatedCentavos: remaining,
  };
}

/**
 * Manual allocation: apply specified amounts to invoices.
 * Requires payment.allocate_manual at the API layer.
 * Sum of manual amounts must not exceed payment; leftover is unallocated credit.
 */
export function allocateManual(
  paymentCentavos: bigint,
  invoices: AllocatableInvoice[],
  manual: ManualAllocationInput[],
): AllocationResult {
  assertPositivePayment(paymentCentavos);

  if (manual.length === 0) {
    throw new Error("Manual allocation requires at least one invoice line.");
  }

  const byId = new Map(invoices.map((inv) => [inv.id, inv]));
  let sumManual = 0n;
  const allocations: AllocationLine[] = [];
  const seen = new Set<string>();

  for (const line of manual) {
    if (line.amountCentavos <= 0n) {
      throw new Error("Manual allocation amounts must be greater than zero.");
    }
    if (seen.has(line.invoiceId)) {
      throw new Error("Duplicate invoice in manual allocation.");
    }
    seen.add(line.invoiceId);

    const inv = byId.get(line.invoiceId);
    if (!inv) {
      throw new Error(`Invoice ${line.invoiceId} is not allocatable.`);
    }
    if (line.amountCentavos > inv.balanceCentavos) {
      throw new Error(
        `Allocation for ${inv.invoiceNumber} exceeds open balance.`,
      );
    }

    sumManual += line.amountCentavos;
    allocations.push({
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      allocatedCentavos: line.amountCentavos,
      previousBalanceCentavos: inv.balanceCentavos,
      remainingBalanceCentavos: inv.balanceCentavos - line.amountCentavos,
      resultingStatus: statusAfterPay(inv.balanceCentavos, line.amountCentavos),
    });
  }

  if (sumManual > paymentCentavos) {
    throw new Error("Manual allocations exceed payment amount.");
  }

  return {
    allocations,
    totalAllocatedCentavos: sumManual,
    unallocatedCentavos: paymentCentavos - sumManual,
  };
}

/** Preview helper: oldest-first unless manual lines are provided. */
export function previewAllocation(
  paymentCentavos: bigint,
  invoices: AllocatableInvoice[],
  manual?: ManualAllocationInput[],
): AllocationResult {
  if (manual && manual.length > 0) {
    return allocateManual(paymentCentavos, invoices, manual);
  }
  return allocateOldestFirst(paymentCentavos, invoices);
}
