import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lt,
  ne,
  sql,
} from "drizzle-orm";
import {
  auditLogs,
  collectionAreas,
  invoices,
  paymentReversals,
  payments,
  receipts,
  serviceAccounts,
  servicePlans,
  serviceTypes,
  subscribers,
  users,
  type Database,
} from "@bcis/db";
import {
  assignAgingBucket,
  centavosToString,
  daysPastDue,
} from "@bcis/shared";
import { AppError } from "../lib/errors.js";
import { getStatementOfAccount } from "./ledger-service.js";
import {
  getBillingVsCollection,
  getCollectorPerformance,
  getPaymentMethodSummary,
} from "./dashboard-service.js";
import {
  getArAgingSummary,
  loadOpenInvoicesForAging,
} from "./receivables-service.js";

type Db = Database["db"];

const COLLECTED = ["POSTED", "VERIFIED"] as const;

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

/** Resolve from/to for collection period presets. */
export function resolveCollectionRange(query: {
  period?: "daily" | "weekly" | "monthly" | "annual";
  fromDate?: string;
  toDate?: string;
}): { fromDate: string; toDate: string; from: Date; toExclusive: Date } {
  const today = todayIso();
  if (query.fromDate && query.toDate) {
    return {
      fromDate: query.fromDate,
      toDate: query.toDate,
      from: startOfUtcDay(query.fromDate),
      toExclusive: endExclusive(query.toDate),
    };
  }

  const period = query.period ?? "daily";
  let fromDate = today;
  let toDate = today;

  if (period === "weekly") {
    const d = startOfUtcDay(today);
    d.setUTCDate(d.getUTCDate() - 6);
    fromDate = d.toISOString().slice(0, 10);
  } else if (period === "monthly") {
    fromDate = `${today.slice(0, 7)}-01`;
  } else if (period === "annual") {
    fromDate = `${today.slice(0, 4)}-01-01`;
  }

  return {
    fromDate,
    toDate,
    from: startOfUtcDay(fromDate),
    toExclusive: endExclusive(toDate),
  };
}

function paginate<T>(items: T[], page: number, pageSize: number) {
  const total = items.length;
  const offset = (page - 1) * pageSize;
  return {
    items: items.slice(offset, offset + pageSize),
    page,
    pageSize,
    total,
  };
}

export async function collectionsReport(
  db: Db,
  query: {
    page: number;
    pageSize: number;
    period?: "daily" | "weekly" | "monthly" | "annual";
    fromDate?: string;
    toDate?: string;
    method?: (typeof COLLECTED extends never ? never : string) | undefined;
    collectorUserId?: string;
    collectionAreaId?: string;
  },
) {
  const range = resolveCollectionRange(query);
  const conditions = [
    inArray(payments.status, [...COLLECTED]),
    gte(payments.receivedAt, range.from),
    lt(payments.receivedAt, range.toExclusive),
  ];
  if (query.method) {
    conditions.push(
      eq(payments.method, query.method as "Cash" | "GCash" | "BankTransfer" | "Cheque" | "Other"),
    );
  }

  const rows = await db
    .select({
      id: payments.id,
      receivedAt: payments.receivedAt,
      method: payments.method,
      amountCentavos: payments.amountCentavos,
      referenceNumber: payments.referenceNumber,
      status: payments.status,
      accountNumber: subscribers.accountNumber,
      subscriberName: subscribers.fullName,
      collectorUserId: subscribers.collectorUserId,
      collectionAreaId: subscribers.collectionAreaId,
      receiptNumber: receipts.receiptNumber,
    })
    .from(payments)
    .innerJoin(subscribers, eq(payments.subscriberId, subscribers.id))
    .leftJoin(receipts, eq(receipts.paymentId, payments.id))
    .where(and(...conditions))
    .orderBy(desc(payments.receivedAt));

  const filtered = rows.filter((r) => {
    if (query.collectorUserId && r.collectorUserId !== query.collectorUserId) {
      return false;
    }
    if (
      query.collectionAreaId &&
      r.collectionAreaId !== query.collectionAreaId
    ) {
      return false;
    }
    return true;
  });

  const totalAmount = filtered.reduce((s, r) => s + r.amountCentavos, 0n);
  const mapped = filtered.map((r) => ({
    id: r.id,
    receivedAt: r.receivedAt.toISOString(),
    accountNumber: r.accountNumber,
    subscriberName: r.subscriberName,
    method: r.method,
    referenceNumber: r.referenceNumber,
    receiptNumber: r.receiptNumber,
    amountCentavos: centavosToString(r.amountCentavos),
    status: r.status,
  }));

  return {
    ...paginate(mapped, query.page, query.pageSize),
    fromDate: range.fromDate,
    toDate: range.toDate,
    totals: {
      amountCentavos: centavosToString(totalAmount),
      count: filtered.length,
    },
    allRows: mapped,
  };
}

export async function paymentMethodReport(
  db: Db,
  query: { fromDate?: string; toDate?: string; page: number; pageSize: number },
) {
  const range = resolveCollectionRange(query);
  const items = await getPaymentMethodSummary(db, {
    from: range.from,
    to: range.toExclusive,
  });
  const totalAmount = items.reduce((s, i) => s + BigInt(i.amountCentavos), 0n);
  const totalCount = items.reduce((s, i) => s + i.count, 0);
  return {
    ...paginate(items, query.page, query.pageSize),
    fromDate: range.fromDate,
    toDate: range.toDate,
    totals: {
      amountCentavos: centavosToString(totalAmount),
      count: totalCount,
    },
    allRows: items,
  };
}

export async function billingVsCollectionReport(db: Db, months: number) {
  const items = await getBillingVsCollection(db, months);
  const billed = items.reduce((s, i) => s + BigInt(i.billedCentavos), 0n);
  const collected = items.reduce((s, i) => s + BigInt(i.collectedCentavos), 0n);
  return {
    items,
    page: 1,
    pageSize: items.length || 1,
    total: items.length,
    totals: {
      billedCentavos: centavosToString(billed),
      collectedCentavos: centavosToString(collected),
    },
    allRows: items,
  };
}

export async function revenueReport(
  db: Db,
  query: {
    groupBy: "plan" | "serviceType" | "area";
    fromDate?: string;
    toDate?: string;
    page: number;
    pageSize: number;
  },
) {
  const range = resolveCollectionRange(query);

  if (query.groupBy === "area") {
    const rows = await db
      .select({
        groupId: collectionAreas.id,
        groupCode: collectionAreas.code,
        groupName: collectionAreas.name,
        amount: sql<string>`coalesce(sum(${invoices.totalCentavos}), 0)`,
        count: sql<number>`count(*)::int`,
      })
      .from(invoices)
      .innerJoin(subscribers, eq(invoices.subscriberId, subscribers.id))
      .leftJoin(
        collectionAreas,
        eq(subscribers.collectionAreaId, collectionAreas.id),
      )
      .where(
        and(
          ne(invoices.status, "VOID"),
          gte(invoices.issuedAt, range.from),
          lt(invoices.issuedAt, range.toExclusive),
        ),
      )
      .groupBy(collectionAreas.id, collectionAreas.code, collectionAreas.name);

    const items = rows.map((r) => ({
      groupId: r.groupId,
      groupCode: r.groupCode ?? "NONE",
      groupName: r.groupName ?? "Unassigned",
      amountCentavos: centavosToString(BigInt(r.amount)),
      invoiceCount: r.count,
    }));
    const totalAmount = items.reduce((s, i) => s + BigInt(i.amountCentavos), 0n);
    return {
      ...paginate(items, query.page, query.pageSize),
      fromDate: range.fromDate,
      toDate: range.toDate,
      groupBy: query.groupBy,
      totals: { amountCentavos: centavosToString(totalAmount) },
      allRows: items,
    };
  }

  const rows = await db
    .select({
      planId: servicePlans.id,
      planCode: servicePlans.code,
      planName: servicePlans.name,
      typeCode: serviceTypes.code,
      typeName: serviceTypes.name,
      amount: sql<string>`coalesce(sum(${invoices.totalCentavos}), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(invoices)
    .innerJoin(
      serviceAccounts,
      eq(invoices.serviceAccountId, serviceAccounts.id),
    )
    .innerJoin(servicePlans, eq(serviceAccounts.servicePlanId, servicePlans.id))
    .innerJoin(serviceTypes, eq(servicePlans.serviceTypeId, serviceTypes.id))
    .where(
      and(
        ne(invoices.status, "VOID"),
        gte(invoices.issuedAt, range.from),
        lt(invoices.issuedAt, range.toExclusive),
      ),
    )
    .groupBy(
      servicePlans.id,
      servicePlans.code,
      servicePlans.name,
      serviceTypes.code,
      serviceTypes.name,
    );

  let items: Array<{
    groupId: string | null;
    groupCode: string;
    groupName: string;
    amountCentavos: string;
    invoiceCount: number;
  }>;

  if (query.groupBy === "serviceType") {
    const map = new Map<
      string,
      { groupCode: string; groupName: string; amount: bigint; count: number }
    >();
    for (const r of rows) {
      const existing = map.get(r.typeCode) ?? {
        groupCode: r.typeCode,
        groupName: r.typeName,
        amount: 0n,
        count: 0,
      };
      existing.amount += BigInt(r.amount);
      existing.count += r.count;
      map.set(r.typeCode, existing);
    }
    items = [...map.entries()].map(([code, v]) => ({
      groupId: code,
      groupCode: v.groupCode,
      groupName: v.groupName,
      amountCentavos: centavosToString(v.amount),
      invoiceCount: v.count,
    }));
  } else {
    items = rows.map((r) => ({
      groupId: r.planId,
      groupCode: r.planCode,
      groupName: r.planName,
      amountCentavos: centavosToString(BigInt(r.amount)),
      invoiceCount: r.count,
    }));
  }

  const totalAmount = items.reduce((s, i) => s + BigInt(i.amountCentavos), 0n);
  return {
    ...paginate(items, query.page, query.pageSize),
    fromDate: range.fromDate,
    toDate: range.toDate,
    groupBy: query.groupBy,
    totals: { amountCentavos: centavosToString(totalAmount) },
    allRows: items,
  };
}

export async function arAgingReport(
  db: Db,
  query: {
    page: number;
    pageSize: number;
    asOfDate?: string;
    collectionAreaId?: string;
    collectorUserId?: string;
  },
) {
  const summary = await getArAgingSummary(db, query);
  const graceDays = summary.graceDays;
  const asOfDate = summary.asOfDate;
  const open = await loadOpenInvoicesForAging(db, {
    collectionAreaId: query.collectionAreaId,
    collectorUserId: query.collectorUserId,
  });

  const subIds = [...new Set(open.map((o) => o.subscriberId))];
  const subMap = new Map<string, { accountNumber: string; fullName: string }>();
  if (subIds.length > 0) {
    const subs = await db
      .select({
        id: subscribers.id,
        accountNumber: subscribers.accountNumber,
        fullName: subscribers.fullName,
      })
      .from(subscribers)
      .where(inArray(subscribers.id, subIds));
    for (const s of subs) {
      subMap.set(s.id, {
        accountNumber: s.accountNumber,
        fullName: s.fullName,
      });
    }
  }

  const detail =
    open.length === 0
      ? []
      : (
          await db
            .select({
              id: invoices.id,
              invoiceNumber: invoices.invoiceNumber,
              dueDate: invoices.dueDate,
              balanceCentavos: invoices.balanceCentavos,
              subscriberId: invoices.subscriberId,
            })
            .from(invoices)
            .where(
              inArray(
                invoices.id,
                open.map((o) => o.id),
              ),
            )
        ).map((inv) => {
          const days = daysPastDue(inv.dueDate, graceDays, asOfDate);
          const sub = subMap.get(inv.subscriberId);
          return {
            invoiceNumber: inv.invoiceNumber,
            accountNumber: sub?.accountNumber ?? "",
            subscriberName: sub?.fullName ?? "",
            dueDate: inv.dueDate,
            daysPastDue: Math.max(0, days),
            bucket: assignAgingBucket(days),
            balanceCentavos: centavosToString(inv.balanceCentavos),
          };
        });

  detail.sort((a, b) => b.daysPastDue - a.daysPastDue);

  return {
    ...paginate(detail, query.page, query.pageSize),
    summary,
    totals: {
      balanceCentavos: summary.totalBalanceCentavos,
      count: summary.totalInvoiceCount,
    },
    allRows: detail,
  };
}

export async function subscriberMasterReport(
  db: Db,
  query: {
    page: number;
    pageSize: number;
    search?: string;
    status?: "ACTIVE" | "INACTIVE" | "TERMINATED" | "ARCHIVED";
    collectionAreaId?: string;
    collectorUserId?: string;
  },
) {
  const conditions = [];
  if (query.status) conditions.push(eq(subscribers.status, query.status));
  if (query.collectionAreaId) {
    conditions.push(eq(subscribers.collectionAreaId, query.collectionAreaId));
  }
  if (query.collectorUserId) {
    conditions.push(eq(subscribers.collectorUserId, query.collectorUserId));
  }
  if (query.search) {
    const q = `%${query.search}%`;
    conditions.push(
      sql`(${subscribers.fullName} ilike ${q} or ${subscribers.accountNumber} ilike ${q} or ${subscribers.contactPhone} ilike ${q})`,
    );
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [totalRow] = await db
    .select({ total: count() })
    .from(subscribers)
    .where(where);

  const offset = (query.page - 1) * query.pageSize;
  const rows = await db
    .select({
      id: subscribers.id,
      accountNumber: subscribers.accountNumber,
      fullName: subscribers.fullName,
      contactPhone: subscribers.contactPhone,
      address: subscribers.address,
      status: subscribers.status,
      dueDay: subscribers.dueDay,
      areaName: collectionAreas.name,
      collectorName: users.fullName,
    })
    .from(subscribers)
    .leftJoin(
      collectionAreas,
      eq(subscribers.collectionAreaId, collectionAreas.id),
    )
    .leftJoin(users, eq(subscribers.collectorUserId, users.id))
    .where(where)
    .orderBy(asc(subscribers.accountNumber))
    .limit(query.pageSize)
    .offset(offset);

  const allForExport = await db
    .select({
      accountNumber: subscribers.accountNumber,
      fullName: subscribers.fullName,
      contactPhone: subscribers.contactPhone,
      address: subscribers.address,
      status: subscribers.status,
      dueDay: subscribers.dueDay,
      areaName: collectionAreas.name,
      collectorName: users.fullName,
    })
    .from(subscribers)
    .leftJoin(
      collectionAreas,
      eq(subscribers.collectionAreaId, collectionAreas.id),
    )
    .leftJoin(users, eq(subscribers.collectorUserId, users.id))
    .where(where)
    .orderBy(asc(subscribers.accountNumber))
    .limit(5000);

  const items = rows.map((r) => ({
    ...r,
    contactPhone: r.contactPhone,
    areaName: r.areaName ?? "",
    collectorName: r.collectorName ?? "",
  }));

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total: totalRow?.total ?? 0,
    allRows: allForExport.map((r) => ({
      accountNumber: r.accountNumber,
      fullName: r.fullName,
      contactPhone: r.contactPhone ?? "",
      address: r.address,
      status: r.status,
      dueDay: r.dueDay,
      areaName: r.areaName ?? "",
      collectorName: r.collectorName ?? "",
    })),
  };
}

export async function ledgerStatementReport(
  db: Db,
  query: {
    subscriberId: string;
    fromDate: string;
    toDate: string;
    page: number;
    pageSize: number;
  },
) {
  const soa = await getStatementOfAccount(
    db,
    query.subscriberId,
    query.fromDate,
    query.toDate,
  );
  const mapped = soa.entries.map((e) => ({
    entryDate: e.entryDate,
    referenceType: e.referenceType,
    description: e.description,
    debitCentavos: e.debitCentavos,
    creditCentavos: e.creditCentavos,
    balanceCentavos: e.balanceCentavos,
  }));
  return {
    ...paginate(mapped, query.page, query.pageSize),
    statement: soa,
    totals: {
      openingBalanceCentavos: soa.openingBalanceCentavos,
      closingBalanceCentavos: soa.closingBalanceCentavos,
    },
    allRows: mapped,
  };
}

/**
 * Collector remittance / shortage / performance.
 * Until collection batches exist, remittance uses collected totals by assigned
 * collector; shortage/overage is 0 (no remittance batch to compare).
 */
export async function collectorReport(
  db: Db,
  query: {
    page: number;
    pageSize: number;
    fromDate?: string;
    toDate?: string;
    collectorUserId?: string;
  },
) {
  const range = resolveCollectionRange(query);
  let items = await getCollectorPerformance(db, {
    from: range.from,
    to: range.toExclusive,
  });
  if (query.collectorUserId) {
    items = items.filter((i) => i.collectorUserId === query.collectorUserId);
  }

  const enriched = items.map((i) => {
    const collected = BigInt(i.collectedCentavos);
    return {
      ...i,
      remittedCentavos: centavosToString(collected),
      shortageOverageCentavos: "0",
      note: "Remittance batches not yet posted; remitted equals collected.",
    };
  });

  const totalCollected = enriched.reduce(
    (s, i) => s + BigInt(i.collectedCentavos),
    0n,
  );

  return {
    ...paginate(enriched, query.page, query.pageSize),
    fromDate: range.fromDate,
    toDate: range.toDate,
    totals: {
      collectedCentavos: centavosToString(totalCollected),
      remittedCentavos: centavosToString(totalCollected),
      shortageOverageCentavos: "0",
    },
    allRows: enriched,
  };
}

export async function reversalsReport(
  db: Db,
  query: {
    page: number;
    pageSize: number;
    fromDate?: string;
    toDate?: string;
  },
) {
  const range = resolveCollectionRange(query);

  const reversalRows = await db
    .select({
      id: paymentReversals.id,
      reason: paymentReversals.reason,
      createdAt: paymentReversals.createdAt,
      actorName: users.fullName,
      paymentId: payments.id,
      amountCentavos: payments.amountCentavos,
      method: payments.method,
      accountNumber: subscribers.accountNumber,
      subscriberName: subscribers.fullName,
      receiptNumber: receipts.receiptNumber,
      receiptStatus: receipts.status,
    })
    .from(paymentReversals)
    .innerJoin(payments, eq(paymentReversals.originalPaymentId, payments.id))
    .innerJoin(subscribers, eq(payments.subscriberId, subscribers.id))
    .leftJoin(users, eq(paymentReversals.actorUserId, users.id))
    .leftJoin(receipts, eq(receipts.paymentId, payments.id))
    .where(
      and(
        gte(paymentReversals.createdAt, range.from),
        lt(paymentReversals.createdAt, range.toExclusive),
      ),
    )
    .orderBy(desc(paymentReversals.createdAt));

  const voidReceipts = await db
    .select({
      id: receipts.id,
      receiptNumber: receipts.receiptNumber,
      amountCentavos: receipts.amountCentavos,
      voidedAt: receipts.voidedAt,
      voidReason: receipts.voidReason,
      accountNumber: subscribers.accountNumber,
      subscriberName: subscribers.fullName,
      method: payments.method,
    })
    .from(receipts)
    .innerJoin(subscribers, eq(receipts.subscriberId, subscribers.id))
    .innerJoin(payments, eq(receipts.paymentId, payments.id))
    .where(
      and(
        eq(receipts.status, "VOID"),
        gte(receipts.voidedAt, range.from),
        lt(receipts.voidedAt, range.toExclusive),
      ),
    )
    .orderBy(desc(receipts.voidedAt));

  const items = [
    ...reversalRows.map((r) => ({
      kind: "REVERSAL" as const,
      id: r.id,
      at: r.createdAt.toISOString(),
      accountNumber: r.accountNumber,
      subscriberName: r.subscriberName,
      receiptNumber: r.receiptNumber,
      method: r.method,
      amountCentavos: centavosToString(r.amountCentavos),
      reason: r.reason,
      actorName: r.actorName ?? "",
    })),
    ...voidReceipts.map((r) => ({
      kind: "VOID_RECEIPT" as const,
      id: r.id,
      at: r.voidedAt?.toISOString() ?? "",
      accountNumber: r.accountNumber,
      subscriberName: r.subscriberName,
      receiptNumber: r.receiptNumber,
      method: r.method,
      amountCentavos: centavosToString(r.amountCentavos),
      reason: r.voidReason ?? "",
      actorName: "",
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const totalAmount = items.reduce((s, i) => s + BigInt(i.amountCentavos), 0n);

  return {
    ...paginate(items, query.page, query.pageSize),
    fromDate: range.fromDate,
    toDate: range.toDate,
    totals: {
      amountCentavos: centavosToString(totalAmount),
      count: items.length,
    },
    allRows: items,
  };
}

export async function auditReport(
  db: Db,
  query: {
    page: number;
    pageSize: number;
    fromDate?: string;
    toDate?: string;
    actorUserId?: string;
    action?: string;
    search?: string;
  },
) {
  const conditions = [];
  if (query.fromDate) {
    conditions.push(gte(auditLogs.createdAt, startOfUtcDay(query.fromDate)));
  }
  if (query.toDate) {
    conditions.push(lt(auditLogs.createdAt, endExclusive(query.toDate)));
  }
  if (query.actorUserId) {
    conditions.push(eq(auditLogs.actorUserId, query.actorUserId));
  }
  if (query.action) {
    conditions.push(sql`${auditLogs.action} ilike ${`%${query.action}%`}`);
  }
  if (query.search) {
    const q = `%${query.search}%`;
    conditions.push(
      sql`(${auditLogs.action} ilike ${q} or ${auditLogs.entityType} ilike ${q} or coalesce(${auditLogs.reason}, '') ilike ${q})`,
    );
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [totalRow] = await db
    .select({ total: count() })
    .from(auditLogs)
    .where(where);

  const offset = (query.page - 1) * query.pageSize;
  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      reason: auditLogs.reason,
      createdAt: auditLogs.createdAt,
      actorUserId: auditLogs.actorUserId,
      actorName: users.fullName,
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorUserId, users.id))
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(query.pageSize)
    .offset(offset);

  const exportRows = await db
    .select({
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      reason: auditLogs.reason,
      createdAt: auditLogs.createdAt,
      actorName: users.fullName,
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorUserId, users.id))
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(5000);

  const items = rows.map((r) => ({
    id: r.id,
    at: r.createdAt.toISOString(),
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    reason: r.reason,
    actorName: r.actorName ?? "",
  }));

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total: totalRow?.total ?? 0,
    allRows: exportRows.map((r) => ({
      at: r.createdAt.toISOString(),
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId ?? "",
      reason: r.reason ?? "",
      actorName: r.actorName ?? "",
    })),
  };
}

export async function getRouteSheet(
  db: Db,
  query: { collectionAreaId: string; collectorUserId?: string },
) {
  const [area] = await db
    .select()
    .from(collectionAreas)
    .where(eq(collectionAreas.id, query.collectionAreaId))
    .limit(1);
  if (!area) throw new AppError(404, "NOT_FOUND", "Collection area not found.");

  const conditions = [
    eq(subscribers.collectionAreaId, query.collectionAreaId),
    eq(subscribers.status, "ACTIVE"),
  ];
  if (query.collectorUserId) {
    conditions.push(eq(subscribers.collectorUserId, query.collectorUserId));
  }

  const subs = await db
    .select()
    .from(subscribers)
    .where(and(...conditions))
    .orderBy(asc(subscribers.accountNumber));

  const today = todayIso();
  const currentPeriod = today.slice(0, 7);

  const openInvoices = await db
    .select({
      subscriberId: invoices.subscriberId,
      billingPeriod: invoices.billingPeriod,
      balanceCentavos: invoices.balanceCentavos,
    })
    .from(invoices)
    .where(
      and(
        inArray(
          invoices.subscriberId,
          subs.map((s) => s.id).length ? subs.map((s) => s.id) : ["00000000-0000-0000-0000-000000000000"],
        ),
        inArray(invoices.status, ["UNPAID", "PARTIALLY_PAID", "OVERDUE"]),
        sql`${invoices.balanceCentavos} > 0`,
      ),
    );

  const bySub = new Map<string, { current: bigint; arrears: bigint }>();
  for (const inv of openInvoices) {
    const entry = bySub.get(inv.subscriberId) ?? { current: 0n, arrears: 0n };
    if (inv.billingPeriod === currentPeriod) {
      entry.current += inv.balanceCentavos;
    } else {
      entry.arrears += inv.balanceCentavos;
    }
    bySub.set(inv.subscriberId, entry);
  }

  const rows = subs.map((s) => {
    const bal = bySub.get(s.id) ?? { current: 0n, arrears: 0n };
    const total = bal.current + bal.arrears;
    return {
      accountNumber: s.accountNumber,
      fullName: s.fullName,
      address: s.address,
      contactPhone: s.contactPhone,
      currentBillCentavos: centavosToString(bal.current),
      arrearsCentavos: centavosToString(bal.arrears),
      totalDueCentavos: centavosToString(total),
    };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      currentBillCentavos: acc.currentBillCentavos + BigInt(r.currentBillCentavos),
      arrearsCentavos: acc.arrearsCentavos + BigInt(r.arrearsCentavos),
      totalDueCentavos: acc.totalDueCentavos + BigInt(r.totalDueCentavos),
    }),
    { currentBillCentavos: 0n, arrearsCentavos: 0n, totalDueCentavos: 0n },
  );

  return {
    areaCode: area.code,
    areaName: area.name,
    generatedAt: new Date().toISOString(),
    rows,
    totals: {
      currentBillCentavos: centavosToString(totals.currentBillCentavos),
      arrearsCentavos: centavosToString(totals.arrearsCentavos),
      totalDueCentavos: centavosToString(totals.totalDueCentavos),
    },
  };
}

// Re-export aging for report routes that need the summary only
export { getArAgingSummary };
