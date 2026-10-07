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
} from "./receivables-service.js";

type Db = Database["db"];

const COLLECTED_STATUSES = ["POSTED", "VERIFIED"] as const;

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

export async function getDashboard(db: Db) {
  const today = new Date().toISOString().slice(0, 10);
  const dayStart = startOfUtcDay(today);
  const dayEnd = endExclusive(today);

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

  const billingVsCollection = await getBillingVsCollection(db, 6);
  const paymentMethods = await getPaymentMethodSummary(db, {
    from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    to: new Date(),
  });
  const arAging = await getArAgingSummary(db, { asOfDate: today });
  const collectorPerformance = await getCollectorPerformance(db, {
    from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    to: new Date(),
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
    billingVsCollection,
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

  const collectorIds = [
    ...new Set(
      [...assigned, ...collected]
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

  const keys = new Set([
    ...assignedMap.keys(),
    ...collectedMap.keys(),
  ]);

  const rows = [...keys].map((collectorUserId) => {
    const c = collectedMap.get(collectorUserId);
    return {
      collectorUserId,
      collectorName: collectorUserId
        ? (nameMap.get(collectorUserId) ?? "Unknown")
        : "Unassigned",
      collectedCentavos: centavosToString(c?.amount ?? 0n),
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
