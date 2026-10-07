import { addCentavos } from "../money.js";

/** Days-past-due aging buckets (SPEC / bcis.mdc). */
export const AGING_BUCKETS = [
  "Current",
  "1-30",
  "31-60",
  "61-90",
  "90+",
] as const;

export type AgingBucket = (typeof AGING_BUCKETS)[number];

export type AgingInvoiceInput = {
  balanceCentavos: bigint;
  dueDate: string;
};

export type AgingBucketTotal = {
  bucket: AgingBucket;
  balanceCentavos: bigint;
  invoiceCount: number;
};

export type AgingSummary = {
  buckets: AgingBucketTotal[];
  totalBalanceCentavos: bigint;
  totalInvoiceCount: number;
};

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d));
}

/** Days past (dueDate + graceDays). Negative or zero ⇒ Current. */
export function daysPastDue(
  dueDate: string,
  graceDays: number,
  today: string,
): number {
  const effectiveDue = parseIsoDate(dueDate);
  effectiveDue.setUTCDate(effectiveDue.getUTCDate() + graceDays);
  const todayDate = parseIsoDate(today);
  const ms = todayDate.getTime() - effectiveDue.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export function assignAgingBucket(daysPast: number): AgingBucket {
  if (daysPast <= 0) return "Current";
  if (daysPast <= 30) return "1-30";
  if (daysPast <= 60) return "31-60";
  if (daysPast <= 90) return "61-90";
  return "90+";
}

/**
 * Sum open invoice balances into aging buckets.
 * Total MUST equal the sum of open balances (acceptance invariant).
 */
export function computeArAging(
  invoices: AgingInvoiceInput[],
  graceDays: number,
  today: string,
): AgingSummary {
  const map = new Map<AgingBucket, { balanceCentavos: bigint; invoiceCount: number }>();
  for (const bucket of AGING_BUCKETS) {
    map.set(bucket, { balanceCentavos: 0n, invoiceCount: 0 });
  }

  let totalBalanceCentavos = 0n;
  for (const inv of invoices) {
    if (inv.balanceCentavos <= 0n) continue;
    const bucket = assignAgingBucket(
      daysPastDue(inv.dueDate, graceDays, today),
    );
    const entry = map.get(bucket)!;
    entry.balanceCentavos += inv.balanceCentavos;
    entry.invoiceCount += 1;
    totalBalanceCentavos = addCentavos(totalBalanceCentavos, inv.balanceCentavos);
  }

  const buckets: AgingBucketTotal[] = AGING_BUCKETS.map((bucket) => {
    const entry = map.get(bucket)!;
    return {
      bucket,
      balanceCentavos: entry.balanceCentavos,
      invoiceCount: entry.invoiceCount,
    };
  });

  return {
    buckets,
    totalBalanceCentavos,
    totalInvoiceCount: buckets.reduce((n, b) => n + b.invoiceCount, 0),
  };
}
