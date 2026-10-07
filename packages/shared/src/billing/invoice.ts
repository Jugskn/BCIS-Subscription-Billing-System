import { addCentavos } from "../money.js";

export const INVOICE_STATUSES = [
  "DRAFT",
  "UNPAID",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "VOID",
  "CREDITED",
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_ITEM_TYPES = [
  "SUBSCRIPTION",
  "INSTALLATION_FEE",
  "RECONNECTION_FEE",
  "DISCOUNT",
  "PENALTY",
  "ADJUSTMENT",
] as const;

export type InvoiceItemType = (typeof INVOICE_ITEM_TYPES)[number];

export type InvoiceLineInput = {
  itemType: InvoiceItemType;
  description: string;
  rateCentavos: bigint;
  quantity?: number;
  amountCentavos: bigint;
};

export type InvoiceTotals = {
  subtotalCentavos: bigint;
  discountCentavos: bigint;
  penaltyCentavos: bigint;
  adjustmentCentavos: bigint;
  totalCentavos: bigint;
};

export function buildSubscriptionLine(
  rateCentavos: bigint,
  description = "Monthly subscription",
): InvoiceLineInput {
  return {
    itemType: "SUBSCRIPTION",
    description,
    rateCentavos,
    quantity: 1,
    amountCentavos: rateCentavos,
  };
}

export function computeInvoiceTotals(lines: InvoiceLineInput[]): InvoiceTotals {
  let subtotalCentavos = 0n;
  let discountCentavos = 0n;
  let penaltyCentavos = 0n;
  let adjustmentCentavos = 0n;

  for (const line of lines) {
    switch (line.itemType) {
      case "SUBSCRIPTION":
      case "INSTALLATION_FEE":
      case "RECONNECTION_FEE":
        subtotalCentavos += line.amountCentavos;
        break;
      case "DISCOUNT":
        discountCentavos += line.amountCentavos;
        break;
      case "PENALTY":
        penaltyCentavos += line.amountCentavos;
        break;
      case "ADJUSTMENT":
        adjustmentCentavos += line.amountCentavos;
        break;
      default:
        break;
    }
  }

  const totalCentavos = addCentavos(
    subtotalCentavos,
    penaltyCentavos,
    adjustmentCentavos,
    -discountCentavos,
  );

  return {
    subtotalCentavos,
    discountCentavos,
    penaltyCentavos,
    adjustmentCentavos,
    totalCentavos: totalCentavos < 0n ? 0n : totalCentavos,
  };
}

export type CreditApplication = {
  creditAppliedCentavos: bigint;
  remainingCreditCentavos: bigint;
  balanceCentavos: bigint;
  paidCentavos: bigint;
  status: InvoiceStatus;
};

/** Auto-apply subscriber unapplied credit to a new invoice (oldest credit first policy at invoice gen). */
export function applyCreditToInvoice(
  totalCentavos: bigint,
  unappliedCreditCentavos: bigint,
): CreditApplication {
  const creditAppliedCentavos =
    unappliedCreditCentavos >= totalCentavos
      ? totalCentavos
      : unappliedCreditCentavos;
  const remainingCreditCentavos = unappliedCreditCentavos - creditAppliedCentavos;
  const paidCentavos = creditAppliedCentavos;
  const balanceCentavos = totalCentavos - paidCentavos;

  let status: InvoiceStatus = "UNPAID";
  if (balanceCentavos === 0n) {
    status = "PAID";
  } else if (paidCentavos > 0n) {
    status = "PARTIALLY_PAID";
  }

  return {
    creditAppliedCentavos,
    remainingCreditCentavos,
    balanceCentavos,
    paidCentavos,
    status,
  };
}

export function computeOverdueStatus(
  dueDate: string,
  graceDays: number,
  today: string,
  currentStatus: InvoiceStatus,
): InvoiceStatus {
  if (
    currentStatus === "VOID" ||
    currentStatus === "PAID" ||
    currentStatus === "CREDITED" ||
    currentStatus === "DRAFT"
  ) {
    return currentStatus;
  }

  const due = parseIsoDate(dueDate);
  due.setUTCDate(due.getUTCDate() + graceDays);
  const todayDate = parseIsoDate(today);

  if (todayDate > due) {
    return "OVERDUE";
  }
  return currentStatus === "OVERDUE" ? "UNPAID" : currentStatus;
}

export function deriveOpenInvoiceStatus(
  totalCentavos: bigint,
  paidCentavos: bigint,
  dueDate: string,
  graceDays: number,
  today: string,
): InvoiceStatus {
  const balance = totalCentavos - paidCentavos;
  if (balance <= 0n) return "PAID";
  if (paidCentavos > 0n) {
    return computeOverdueStatus(dueDate, graceDays, today, "PARTIALLY_PAID");
  }
  return computeOverdueStatus(dueDate, graceDays, today, "UNPAID");
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d));
}

export type VoidLedgerOffset = {
  debitCentavos: bigint;
  creditCentavos: bigint;
  description: string;
};

/** Void posts offsetting ledger entry (credit) for remaining invoice balance. */
export function computeVoidLedgerOffset(invoice: {
  invoiceNumber: string;
  balanceCentavos: bigint;
  paidCentavos: bigint;
}): VoidLedgerOffset {
  const remaining = invoice.balanceCentavos;
  return {
    debitCentavos: 0n,
    creditCentavos: remaining > 0n ? remaining : 0n,
    description: `Void invoice ${invoice.invoiceNumber}`,
  };
}

export type AdjustmentLedgerEntry = {
  debitCentavos: bigint;
  creditCentavos: bigint;
  description: string;
};

/** Positive amount = additional charge (debit); negative = credit to subscriber. */
export function computeAdjustmentLedgerOffset(
  invoiceNumber: string,
  amountCentavos: bigint,
  reason: string,
): AdjustmentLedgerEntry {
  if (amountCentavos === 0n) {
    throw new Error("Adjustment amount cannot be zero.");
  }
  if (amountCentavos > 0n) {
    return {
      debitCentavos: amountCentavos,
      creditCentavos: 0n,
      description: `Adjustment (debit) on ${invoiceNumber}: ${reason}`,
    };
  }
  const abs = -amountCentavos;
  return {
    debitCentavos: 0n,
    creditCentavos: abs,
    description: `Adjustment (credit) on ${invoiceNumber}: ${reason}`,
  };
}
