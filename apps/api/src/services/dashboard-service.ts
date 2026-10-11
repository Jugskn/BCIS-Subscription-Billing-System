import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
  invoices,
  payments,
  receipts,
  subscribers,
  users,
  type Database,
} from "@bcis/db";
import { centavosToString } from "@bcis/shared";
import {
  getArAgingSummary,
  getReceivableTotals,
  listOverdueAlerts,
  listSuspensionCandidates,
} from "./receivables-service.js";

type Db = Database["db"];

const COLLECTED_STATUSES = ["POSTED", "VERIFIED"] as const;
const OPEN_INVOICE_STATUSES = ["UNPAID", "PARTIALLY_PAID", "OVERDUE"] as const;

const DASHBOARD_CACHE_TTL_MS = 15_000;

type DashboardPayload = Awaited<ReturnType<typeof buildDashboard>>;

let dashboardCache: { expiresAt: number; value: DashboardPayload } | null =
  null;

function monthKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function startOfUtcDay(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

function endExclusive(isoDate: string): Date {
  const d = startOfUtcDay(isoDate);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Inclusive calendar-day window ending today (UTC). */
export function lastNDaysRange(days: number): {
  fromDate: string;
  toDate: string;
  from: Date;
  toExclusive: Date;
} {
  const toDate = todayIso();
  const from = startOfUtcDay(toDate);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  const fromDate = from.toISOString().slice(0, 10);
  return {
    fromDate,
    toDate,
    from: startOfUtcDay(fromDate),
    toExclusive: endExclusive(toDate),
  };
}

export function clearDashboardCache(): void {
  dashboardCache = null;
}

export async function getDashboard(db: Db) {
  const skipCache =
    process.env.VITEST === "true" || process.env.NODE_ENV === "test";
  const now = Date.now();
  if (!skipCache && dashboardCache && dashboardCache.expiresAt > now) {
    return dashboardCache.value;
  }
  const value = await buildDashboard(db);
  if (!skipCache) {
    dashboardCache = { expiresAt: now + DASHBOARD_CACHE_TTL_MS, value };
  }
  return value;
}

async function buildDashboard(db: Db) {
  const today = todayIso();
  const dayStart = startOfUtcDay(today);
  const dayEnd = endExclusive(today);
  const trailing30 = lastNDaysRange(30);

  const [todayRow] = await db
    .select({
      total: sql<string>`coalesce(sum(${payments.amountCentavos}), 0)`,
    })
    .from(payments)
    .where(
      and(
        inArray(payments.status, [...COLLECTED_STATUSES]),
        gte(payments.receivedAt, dayStart),
        lt(payments.receivedAt, dayEnd),
      ),
    );

  const receivable = await getReceivableTotals(db, today);

  const [pendingGcash] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(payments)
    .where(and(eq(payments.method, "GCash"), eq(payments.status, "PENDING")));

  const suspensionCandidates = await listSuspensionCandidates(db, {
    page: 1,
    pageSize: 1,
  });

  const billingMonths = 6;
  const billingVsCollection = await getBillingVsCollection(db, billingMonths);
  const collectionsTrend = await getCollectionsTrend(db, 30);
  const paymentMethods = await getPaymentMethodSummary(db, {
    from: trailing30.from,
    to: trailing30.toExclusive,
  });
  const arAging = await getArAgingSummary(db, { asOfDate: today });
  const collectorPerformance = await getCollectorPerformance(db, {
    from: trailing30.from,
    to: trailing30.toExclusive,
  });
  const overdueAlerts = await listOverdueAlerts(db, 8);
  const recentPayments = await listRecentPayments(db, 10);

  return {
    kpis: {
      todayCollectionsCentavos: centavosToString(
        BigInt(todayRow?.total ?? "0"),
      ),
      currentReceivableCentavos: centavosToString(
        receivable.currentReceivableCentavos,
      ),
      overdueReceivableCentavos: centavosToString(
        receivable.overdueReceivableCentavos,
      ),
      subscribersOverdueCount: receivable.subscribersOverdueCount,
      pendingGcashCount: pendingGcash?.count ?? 0,
    },
    actionRequired: {
      overdueSubscribersCount: receivable.subscribersOverdueCount,
      followUpSubscribersCount: receivable.followUpSubscribersCount,
      suspensionCandidatesCount: suspensionCandidates.totals.count,
    },
    windows: {
      collectionsTrendDays: 30,
      paymentMethodsFromDate: trailing30.fromDate,
      paymentMethodsToDate: trailing30.toDate,
      collectorFromDate: trailing30.fromDate,
      collectorToDate: trailing30.toDate,
      billingMonths,
    },
    billingVsCollection,
    collectionsTrend,
    paymentMethods,
    arAging,
    collectorPerformance,
    overdueAlerts,
    recentPayments,
  };
}

export async function getBillingVsCollection(db: Db, months: number) {
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1),
  );

  const billedRows = await db
    .select({
      month: invoices.billingPeriod,
      total: sql<string>`coalesce(sum(${invoices.totalCentavos}), 0)`,
    })
    .from(invoices)
    .where(
      and(
        gte(invoices.billingPeriod, monthKey(start)),
        sql`${invoices.status} <> 'VOID'`,
      ),
    )
    .groupBy(invoices.billingPeriod);

  const collectedRows = await db
    .select({
      month: sql<string>`to_char(${payments.receivedAt} AT TIME ZONE 'UTC', 'YYYY-MM')`,
      total: sql<string>`coalesce(sum(${payments.amountCentavos}), 0)`,
    })
    .from(payments)
    .where(
      and(
        inArray(payments.status, [...COLLECTED_STATUSES]),
        gte(payments.receivedAt, start),
      ),
    )
    .groupBy(sql`to_char(${payments.receivedAt} AT TIME ZONE 'UTC', 'YYYY-MM')`);

  const billedMap = new Map(billedRows.map((r) => [r.month, BigInt(r.total)]));
  const collectedMap = new Map(
    collectedRows.map((r) => [r.month, BigInt(r.total)]),
  );

  const result: Array<{
    month: string;
    billedCentavos: string;
    collectedCentavos: string;
  }> = [];

  for (let i = 0; i < months; i++) {
    const d = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1),
    );
    const key = monthKey(d);
    result.push({
      month: key,
      billedCentavos: centavosToString(billedMap.get(key) ?? 0n),
      collectedCentavos: centavosToString(collectedMap.get(key) ?? 0n),
    });
  }
  return result;
}

export async function getCollectionsTrend(db: Db, days: number) {
  const range = lastNDaysRange(days);
  const rows = await db
    .select({
      date: sql<string>`to_char(${payments.receivedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      total: sql<string>`coalesce(sum(${payments.amountCentavos}), 0)`,
    })
    .from(payments)
    .where(
      and(
        inArray(payments.status, [...COLLECTED_STATUSES]),
        gte(payments.receivedAt, range.from),
        lt(payments.receivedAt, range.toExclusive),
      ),
    )
    .groupBy(
      sql`to_char(${payments.receivedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
    );

  const byDate = new Map(rows.map((r) => [r.date, BigInt(r.total)]));
  const result: Array<{ date: string; collectedCentavos: string }> = [];
  const cursor = new Date(range.from);
  for (let i = 0; i < days; i++) {
    const key = cursor.toISOString().slice(0, 10);
    result.push({
      date: key,
      collectedCentavos: centavosToString(byDate.get(key) ?? 0n),
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

export async function getPaymentMethodSummary(
  db: Db,
  range: { from: Date; to: Date },
) {
  const rows = await db
    .select({
      method: payments.method,
      amount: sql<string>`coalesce(sum(${payments.amountCentavos}), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(payments)
    .where(
      and(
        inArray(payments.status, [...COLLECTED_STATUSES]),
        gte(payments.receivedAt, range.from),
        lt(payments.receivedAt, range.to),
      ),
    )
    .groupBy(payments.method);

  const methods = ["Cash", "GCash", "BankTransfer", "Cheque", "Other"] as const;
  return methods.map((method) => {
    const row = rows.find((r) => r.method === method);
    return {
      method,
      amountCentavos: centavosToString(BigInt(row?.amount ?? "0")),
      count: row?.count ?? 0,
    };
  });
}

export async function getCollectorPerformance(
  db: Db,
  range: { from: Date; to: Date },
) {
  const assigned = await db
    .select({
      collectorUserId: subscribers.collectorUserId,
      count: sql<number>`count(*)::int`,
    })
    .from(subscribers)
    .where(eq(subscribers.status, "ACTIVE"))
    .groupBy(subscribers.collectorUserId);

  const collected = await db
    .select({
      collectorUserId: subscribers.collectorUserId,
      amount: sql<string>`coalesce(sum(${payments.amountCentavos}), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(payments)
    .innerJoin(subscribers, eq(payments.subscriberId, subscribers.id))
    .where(
      and(
        inArray(payments.status, [...COLLECTED_STATUSES]),
        gte(payments.receivedAt, range.from),
        lt(payments.receivedAt, range.to),
      ),
    )
    .groupBy(subscribers.collectorUserId);

  const expected = await db
    .select({
      collectorUserId: subscribers.collectorUserId,
      amount: sql<string>`coalesce(sum(${invoices.balanceCentavos}), 0)`,
    })
    .from(invoices)
    .innerJoin(subscribers, eq(invoices.subscriberId, subscribers.id))
    .where(inArray(invoices.status, [...OPEN_INVOICE_STATUSES]))
    .groupBy(subscribers.collectorUserId);

  const collectorIds = [
    ...new Set(
      [...assigned, ...collected, ...expected]
        .map((r) => r.collectorUserId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const nameMap = new Map<string, string>();
  if (collectorIds.length > 0) {
    const names = await db
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .where(inArray(users.id, collectorIds));
    for (const n of names) nameMap.set(n.id, n.fullName);
  }

  const assignedMap = new Map(
    assigned.map((a) => [a.collectorUserId, a.count]),
  );
  const collectedMap = new Map(
    collected.map((c) => [
      c.collectorUserId,
      { amount: BigInt(c.amount), count: c.count },
    ]),
  );
  const expectedMap = new Map(
    expected.map((e) => [e.collectorUserId, BigInt(e.amount)]),
  );

  const keys = new Set([
    ...assignedMap.keys(),
    ...collectedMap.keys(),
    ...expectedMap.keys(),
  ]);

  const rows = [...keys].map((collectorUserId) => {
    const c = collectedMap.get(collectorUserId);
    return {
      collectorUserId,
      collectorName: collectorUserId
        ? (nameMap.get(collectorUserId) ?? "Unknown")
        : "Unassigned",
      collectedCentavos: centavosToString(c?.amount ?? 0n),
      expectedCentavos: centavosToString(
        expectedMap.get(collectorUserId) ?? 0n,
      ),
      paymentCount: c?.count ?? 0,
      assignedSubscribers: assignedMap.get(collectorUserId) ?? 0,
    };
  });

  rows.sort((a, b) =>
    BigInt(b.collectedCentavos) > BigInt(a.collectedCentavos) ? 1 : -1,
  );
  return rows;
}

async function listRecentPayments(db: Db, limit: number) {
  const rows = await db
    .select({
      id: payments.id,
      receivedAt: payments.receivedAt,
      method: payments.method,
      amountCentavos: payments.amountCentavos,
      subscriberName: subscribers.fullName,
      accountNumber: subscribers.accountNumber,
      receiptNumber: receipts.receiptNumber,
    })
    .from(payments)
    .innerJoin(subscribers, eq(payments.subscriberId, subscribers.id))
    .leftJoin(receipts, eq(receipts.paymentId, payments.id))
    .where(inArray(payments.status, [...COLLECTED_STATUSES]))
    .orderBy(desc(payments.receivedAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    receivedAt: r.receivedAt.toISOString(),
    subscriberName: r.subscriberName,
    accountNumber: r.accountNumber,
    method: r.method,
    amountCentavos: centavosToString(r.amountCentavos),
    receiptNumber: r.receiptNumber,
  }));
}
