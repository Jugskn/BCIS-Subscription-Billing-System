/** Billing period utilities (YYYY-MM). */

export type BillingPeriod = `${number}-${string}`;

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function parseBillingPeriod(period: string): { year: number; month: number } {
  const match = PERIOD_RE.exec(period);
  if (!match) {
    throw new Error(`Invalid billing period: ${period}. Expected YYYY-MM.`);
  }
  return { year: Number(match[1]), month: Number(match[2]) };
}

export function formatBillingPeriod(year: number, month: number): BillingPeriod {
  if (month < 1 || month > 12) {
    throw new Error(`Invalid month: ${month}`);
  }
  return `${year}-${String(month).padStart(2, "0")}` as BillingPeriod;
}

/** Last day of month, clamped to 28 for due-day safety per subscriber rules. */
export function computeDueDate(
  billingPeriod: string,
  dueDay: number,
): string {
  if (dueDay < 1 || dueDay > 28) {
    throw new Error(`Due day must be 1–28: ${dueDay}`);
  }
  const { year, month } = parseBillingPeriod(billingPeriod);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(dueDay, lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Service account is billable when ACTIVE and billing started on or before period end. */
export function isBillableForPeriod(
  account: { status: string; billingStartDate: string },
  billingPeriod: string,
): boolean {
  if (account.status !== "ACTIVE") return false;
  const { year, month } = parseBillingPeriod(billingPeriod);
  const periodEnd = `${year}-${String(month).padStart(2, "0")}-${String(
    new Date(Date.UTC(year, month, 0)).getUTCDate(),
  ).padStart(2, "0")}`;
  return account.billingStartDate <= periodEnd;
}
