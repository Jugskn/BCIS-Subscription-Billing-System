import { and, asc, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import {
  collectionAreas,
  invoices,
  payments,
  reconnectionRecords,
  serviceAccounts,
  servicePlans,
  serviceTypes,
  subscribers,
  suspensionRecords,
  users,
  type Database,
} from "@bcis/db";
import {
  assignAgingBucket,
  centavosToString,
  computeArAging,
  computeOverdueStatus,
  daysPastDue,
  type DelinquencyAgeBucket,
  type OutstandingListQuery,
  type OverdueListQuery,
  type SuspensionCandidatesQuery,
  type SuspensionHistoryQuery,
} from "@bcis/shared";
import {
  getFollowUpThresholdDays,
  getGraceDays,
  getSuspensionThresholdMonths,
  getSuspensionThresholdCentavos,
} from "./settings-service.js";

const OPEN_STATUSES = ["UNPAID", "PARTIALLY_PAID", "OVERDUE"] as const;

type Db = Database["db"];

type ReceivableFilters = {
  collectionAreaId?: string;
  collectorUserId?: string;
  servicePlanId?: string;
  serviceTypeCode?: string;
};

export type OpenInvoiceDetail = {
  id: string;
  invoiceNumber: string;
  billingPeriod: string;
  balanceCentavos: bigint;
  dueDate: string;
  status: string;
  subscriberId: string;
  serviceAccountId: string;
  accountNumber: string;
  subscriberName: string;
  serviceName: string;
  serviceTypeCode: string;
  servicePlanId: string;
  collectionAreaId: string | null;
  collectionAreaName: string | null;
  collectorUserId: string | null;
  collectorName: string | null;
  serviceAccountStatus: string;
};

function todayIso(asOf?: string): string {
  if (asOf) return asOf;
  return new Date().toISOString().slice(0, 10);
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d));
}

function monthsBetween(oldestDue: string, today: string): number {
  const a = parseIsoDate(oldestDue);
  const b = parseIsoDate(today);
  const months =
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
    (b.getUTCMonth() - a.getUTCMonth());
  return Math.max(0, months);
}

function paginate<T>(items: T[], page: number, pageSize: number) {
  const offset = (page - 1) * pageSize;
  return {
    items: items.slice(offset, offset + pageSize),
    page,
    pageSize,
    total: items.length,
  };
}

function matchesFilters(
  row: {
    collectionAreaId: string | null;
    collectorUserId: string | null;
    servicePlanId: string;
    serviceTypeCode: string;
  },
  filters?: ReceivableFilters,
): boolean {
  if (!filters) return true;
  if (
    filters.collectionAreaId &&
    row.collectionAreaId !== filters.collectionAreaId
  ) {
    return false;
  }
  if (
    filters.collectorUserId &&
    row.collectorUserId !== filters.collectorUserId
  ) {
    return false;
  }
  if (filters.servicePlanId && row.servicePlanId !== filters.servicePlanId) {
    return false;
  }
  if (
    filters.serviceTypeCode &&
    row.serviceTypeCode !== filters.serviceTypeCode
  ) {
    return false;
  }
  return true;
}

/**
 * Open invoices with positive balance, enriched for receivables lists.
 * Area/collector filters match aging (subscriber assignment).
 */
export async function loadOpenInvoicesDetailed(
  db: Db,
  filters?: ReceivableFilters,
): Promise<OpenInvoiceDetail[]> {
  const conditions = [
    inArray(invoices.status, [...OPEN_STATUSES]),
    gt(invoices.balanceCentavos, 0n),
    ne(invoices.status, "VOID"),
  ];

  const rows = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      billingPeriod: invoices.billingPeriod,
      balanceCentavos: invoices.balanceCentavos,
      dueDate: invoices.dueDate,
      status: invoices.status,
      subscriberId: invoices.subscriberId,
      serviceAccountId: invoices.serviceAccountId,
      accountNumber: serviceAccounts.accountNumber,
      subscriberName: subscribers.fullName,
      serviceName: servicePlans.name,
      serviceTypeCode: serviceTypes.code,
      servicePlanId: servicePlans.id,
      collectionAreaId: subscribers.collectionAreaId,
      collectionAreaName: collectionAreas.name,
      collectorUserId: subscribers.collectorUserId,
      collectorName: users.fullName,
      serviceAccountStatus: serviceAccounts.status,
    })
    .from(invoices)
    .innerJoin(subscribers, eq(invoices.subscriberId, subscribers.id))
    .innerJoin(
      serviceAccounts,
      eq(invoices.serviceAccountId, serviceAccounts.id),
    )
    .innerJoin(servicePlans, eq(serviceAccounts.servicePlanId, servicePlans.id))
    .innerJoin(serviceTypes, eq(servicePlans.serviceTypeId, serviceTypes.id))
    .leftJoin(
      collectionAreas,
      eq(subscribers.collectionAreaId, collectionAreas.id),
    )
    .leftJoin(users, eq(subscribers.collectorUserId, users.id))
    .where(and(...conditions));

  return rows.filter((r) => matchesFilters(r, filters));
}

/** Open invoices with positive balance (shared by aging, dashboard, reports). */
export async function loadOpenInvoicesForAging(
  db: Db,
  filters?: {
    collectionAreaId?: string;
    collectorUserId?: string;
  },
) {
  const detailed = await loadOpenInvoicesDetailed(db, filters);
  return detailed.map((r) => ({
    id: r.id,
    balanceCentavos: r.balanceCentavos,
    dueDate: r.dueDate,
    status: r.status,
    subscriberId: r.subscriberId,
    collectionAreaId: r.collectionAreaId,
    collectorUserId: r.collectorUserId,
  }));
}

export async function getArAgingSummary(
  db: Db,
  opts?: {
    asOfDate?: string;
    collectionAreaId?: string;
    collectorUserId?: string;
  },
) {
  const asOfDate = todayIso(opts?.asOfDate);
  const graceDays = await getGraceDays(db);
  const open = await loadOpenInvoicesForAging(db, {
    collectionAreaId: opts?.collectionAreaId,
    collectorUserId: opts?.collectorUserId,
  });

  const summary = computeArAging(
    open.map((r) => ({
      balanceCentavos: r.balanceCentavos,
      dueDate: r.dueDate,
    })),
    graceDays,
    asOfDate,
  );

  return {
    asOfDate,
    graceDays,
    buckets: summary.buckets.map((b) => ({
      bucket: b.bucket,
      balanceCentavos: centavosToString(b.balanceCentavos),
      invoiceCount: b.invoiceCount,
    })),
    totalBalanceCentavos: centavosToString(summary.totalBalanceCentavos),
    totalInvoiceCount: summary.totalInvoiceCount,
  };
}

/** Current vs overdue receivable totals (same open-invoice set as aging). */
export async function getReceivableTotals(
  db: Db,
  asOfDate?: string,
): Promise<{
  currentReceivableCentavos: bigint;
  overdueReceivableCentavos: bigint;
  subscribersOverdueCount: number;
  followUpSubscribersCount: number;
  followUpThresholdDays: number;
  totalOpenCentavos: bigint;
}> {
  const today = todayIso(asOfDate);
  const graceDays = await getGraceDays(db);
  const followUpThresholdDays = await getFollowUpThresholdDays(db);
  const open = await loadOpenInvoicesForAging(db);

  let currentReceivableCentavos = 0n;
  let overdueReceivableCentavos = 0n;
  const overdueSubscribers = new Set<string>();
  const followUpSubscribers = new Set<string>();

  for (const inv of open) {
    const status = computeOverdueStatus(
      inv.dueDate,
      graceDays,
      today,
      inv.status === "PARTIALLY_PAID" ? "PARTIALLY_PAID" : "UNPAID",
    );
    if (status === "OVERDUE") {
      overdueReceivableCentavos += inv.balanceCentavos;
      overdueSubscribers.add(inv.subscriberId);
      const dpd = daysPastDue(inv.dueDate, graceDays, today);
      if (dpd >= followUpThresholdDays) {
        followUpSubscribers.add(inv.subscriberId);
      }
    } else {
      currentReceivableCentavos += inv.balanceCentavos;
    }
  }

  return {
    currentReceivableCentavos,
    overdueReceivableCentavos,
    subscribersOverdueCount: overdueSubscribers.size,
    followUpSubscribersCount: followUpSubscribers.size,
    followUpThresholdDays,
    totalOpenCentavos: currentReceivableCentavos + overdueReceivableCentavos,
  };
}

export async function listOverdueAlerts(db: Db, limit = 10) {
  const today = todayIso();
  const graceDays = await getGraceDays(db);
  const open = await loadOpenInvoicesForAging(db);

  type Acc = {
    subscriberId: string;
    arrearsCentavos: bigint;
    oldestDueDate: string;
  };
  const bySub = new Map<string, Acc>();

  for (const inv of open) {
    const status = computeOverdueStatus(
      inv.dueDate,
      graceDays,
      today,
      inv.status === "PARTIALLY_PAID" ? "PARTIALLY_PAID" : "UNPAID",
    );
    if (status !== "OVERDUE") continue;
    const existing = bySub.get(inv.subscriberId);
    if (!existing) {
      bySub.set(inv.subscriberId, {
        subscriberId: inv.subscriberId,
        arrearsCentavos: inv.balanceCentavos,
        oldestDueDate: inv.dueDate,
      });
    } else {
      existing.arrearsCentavos += inv.balanceCentavos;
      if (inv.dueDate < existing.oldestDueDate) {
        existing.oldestDueDate = inv.dueDate;
      }
    }
  }

  const sorted = [...bySub.values()].sort((a, b) =>
    a.arrearsCentavos === b.arrearsCentavos
      ? a.oldestDueDate.localeCompare(b.oldestDueDate)
      : a.arrearsCentavos > b.arrearsCentavos
        ? -1
        : 1,
  );
  const top = sorted.slice(0, limit);
  if (top.length === 0) return [];

  const ids = top.map((t) => t.subscriberId);
  const subs = await db
    .select({
      id: subscribers.id,
      accountNumber: subscribers.accountNumber,
      fullName: subscribers.fullName,
    })
    .from(subscribers)
    .where(inArray(subscribers.id, ids));
  const subMap = new Map(subs.map((s) => [s.id, s]));

  return top.map((t) => {
    const sub = subMap.get(t.subscriberId);
    return {
      subscriberId: t.subscriberId,
      accountNumber: sub?.accountNumber ?? "",
      fullName: sub?.fullName ?? "",
      arrearsCentavos: centavosToString(t.arrearsCentavos),
      oldestDueDate: t.oldestDueDate,
    };
  });
}

/** Sum of open invoice balances — must match AR aging total. */
export async function sumOpenInvoiceBalances(db: Db): Promise<bigint> {
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${invoices.balanceCentavos}), 0)`,
    })
    .from(invoices)
    .where(
      and(
        inArray(invoices.status, [...OPEN_STATUSES]),
        gt(invoices.balanceCentavos, 0n),
      ),
    );
  return BigInt(row?.total ?? "0");
}

type SaAgg = {
  serviceAccountId: string;
  subscriberId: string;
  accountNumber: string;
  subscriberName: string;
  serviceName: string;
  serviceTypeCode: string;
  collectionAreaName: string | null;
  collectorName: string | null;
  serviceAccountStatus: string;
  balanceCentavos: bigint;
  oldestDueDate: string;
  oldestInvoiceNumber: string;
  maxDaysPastDue: number;
  openInvoiceCount: number;
};

function aggregateByServiceAccount(
  open: OpenInvoiceDetail[],
  graceDays: number,
  today: string,
  overdueOnly: boolean,
): SaAgg[] {
  const map = new Map<string, SaAgg>();
  for (const inv of open) {
    const days = daysPastDue(inv.dueDate, graceDays, today);
    const status = computeOverdueStatus(
      inv.dueDate,
      graceDays,
      today,
      inv.status === "PARTIALLY_PAID" ? "PARTIALLY_PAID" : "UNPAID",
    );
    if (overdueOnly && status !== "OVERDUE") continue;

    const existing = map.get(inv.serviceAccountId);
    if (!existing) {
      map.set(inv.serviceAccountId, {
        serviceAccountId: inv.serviceAccountId,
        subscriberId: inv.subscriberId,
        accountNumber: inv.accountNumber,
        subscriberName: inv.subscriberName,
        serviceName: inv.serviceName,
        serviceTypeCode: inv.serviceTypeCode,
        collectionAreaName: inv.collectionAreaName,
        collectorName: inv.collectorName,
        serviceAccountStatus: inv.serviceAccountStatus,
        balanceCentavos: inv.balanceCentavos,
        oldestDueDate: inv.dueDate,
        oldestInvoiceNumber: inv.invoiceNumber,
        maxDaysPastDue: Math.max(0, days),
        openInvoiceCount: 1,
      });
    } else {
      existing.balanceCentavos += inv.balanceCentavos;
      existing.openInvoiceCount += 1;
      existing.maxDaysPastDue = Math.max(existing.maxDaysPastDue, Math.max(0, days));
      if (inv.dueDate < existing.oldestDueDate) {
        existing.oldestDueDate = inv.dueDate;
        existing.oldestInvoiceNumber = inv.invoiceNumber;
      }
    }
  }
  return [...map.values()];
}

async function lastPaymentBySubscriber(
  db: Db,
  subscriberIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (subscriberIds.length === 0) return map;
  const rows = await db
    .select({
      subscriberId: payments.subscriberId,
      receivedAt: payments.receivedAt,
    })
    .from(payments)
    .where(
      and(
        inArray(payments.subscriberId, subscriberIds),
        inArray(payments.status, ["POSTED", "VERIFIED"]),
      ),
    )
    .orderBy(desc(payments.receivedAt));
  for (const row of rows) {
    if (!map.has(row.subscriberId)) {
      map.set(row.subscriberId, row.receivedAt.toISOString().slice(0, 10));
    }
  }
  return map;
}

export async function listOutstandingReceivables(
  db: Db,
  query: OutstandingListQuery,
) {
  const open = await loadOpenInvoicesDetailed(db, query);
  const graceDays = await getGraceDays(db);
  const today = todayIso();
  const aggs = aggregateByServiceAccount(open, graceDays, today, false);
  aggs.sort((a, b) =>
    a.balanceCentavos === b.balanceCentavos
      ? a.oldestDueDate.localeCompare(b.oldestDueDate)
      : a.balanceCentavos > b.balanceCentavos
        ? -1
        : 1,
  );

  const totalBalanceCentavos = aggs.reduce(
    (s, a) => s + a.balanceCentavos,
    0n,
  );
  const page = paginate(aggs, query.page, query.pageSize);

  return {
    ...page,
    items: page.items.map((a) => ({
      serviceAccountId: a.serviceAccountId,
      subscriberId: a.subscriberId,
      accountNumber: a.accountNumber,
      subscriberName: a.subscriberName,
      serviceName: a.serviceName,
      serviceTypeCode: a.serviceTypeCode,
      collectionAreaName: a.collectionAreaName,
      collectorName: a.collectorName,
      currentBalanceCentavos: centavosToString(a.balanceCentavos),
      oldestDueDate: a.oldestDueDate,
      status: a.serviceAccountStatus,
    })),
    totals: {
      balanceCentavos: centavosToString(totalBalanceCentavos),
      count: aggs.length,
    },
    allRows: aggs.map((a) => ({
      accountNumber: a.accountNumber,
      subscriberName: a.subscriberName,
      serviceName: a.serviceName,
      collectionAreaName: a.collectionAreaName ?? "",
      collectorName: a.collectorName ?? "",
      currentBalanceCentavos: centavosToString(a.balanceCentavos),
      oldestDueDate: a.oldestDueDate,
    })),
  };
}

export async function listOverdueReceivables(db: Db, query: OverdueListQuery) {
  const open = await loadOpenInvoicesDetailed(db, query);
  const graceDays = await getGraceDays(db);
  const today = todayIso();
  let aggs = aggregateByServiceAccount(open, graceDays, today, true);

  if (query.delinquencyAgeBucket) {
    const bucket = query.delinquencyAgeBucket as DelinquencyAgeBucket;
    aggs = aggs.filter(
      (a) => assignAgingBucket(a.maxDaysPastDue) === bucket,
    );
  }

  aggs.sort((a, b) =>
    a.maxDaysPastDue === b.maxDaysPastDue
      ? a.oldestDueDate.localeCompare(b.oldestDueDate)
      : b.maxDaysPastDue - a.maxDaysPastDue,
  );

  const lastPay = await lastPaymentBySubscriber(
    db,
    [...new Set(aggs.map((a) => a.subscriberId))],
  );

  const totalArrearsCentavos = aggs.reduce((s, a) => s + a.balanceCentavos, 0n);
  const enriched = aggs.map((a) => ({
    serviceAccountId: a.serviceAccountId,
    subscriberId: a.subscriberId,
    accountNumber: a.accountNumber,
    subscriberName: a.subscriberName,
    serviceName: a.serviceName,
    serviceTypeCode: a.serviceTypeCode,
    collectionAreaName: a.collectionAreaName,
    collectorName: a.collectorName,
    monthsUnpaid: monthsBetween(a.oldestDueDate, today),
    oldestUnpaidInvoice: a.oldestInvoiceNumber,
    oldestDueDate: a.oldestDueDate,
    lastPaymentDate: lastPay.get(a.subscriberId) ?? null,
    totalArrearsCentavos: centavosToString(a.balanceCentavos),
    daysPastDue: a.maxDaysPastDue,
    delinquencyAgeBucket: assignAgingBucket(a.maxDaysPastDue) as
      | DelinquencyAgeBucket
      | "Current",
    status: a.serviceAccountStatus,
  }));

  const page = paginate(enriched, query.page, query.pageSize);
  return {
    ...page,
    totals: {
      arrearsCentavos: centavosToString(totalArrearsCentavos),
      count: enriched.length,
    },
    allRows: enriched,
  };
}

export async function listSuspensionCandidates(
  db: Db,
  query: SuspensionCandidatesQuery,
) {
  const threshold = await getSuspensionThresholdCentavos(db);
  const monthsThreshold = await getSuspensionThresholdMonths(db);
  const graceDays = await getGraceDays(db);
  const today = todayIso();
  const open = await loadOpenInvoicesDetailed(db, query);
  const aggs = aggregateByServiceAccount(open, graceDays, today, false).filter(
    (a) => {
      if (a.serviceAccountStatus !== "ACTIVE") return false;
      const monthsUnpaid = monthsBetween(a.oldestDueDate, today);
      const byAmount = a.balanceCentavos > threshold;
      const byMonths =
        monthsThreshold > 0 && monthsUnpaid >= monthsThreshold;
      return byAmount || byMonths;
    },
  );

  aggs.sort((a, b) =>
    a.balanceCentavos === b.balanceCentavos
      ? b.maxDaysPastDue - a.maxDaysPastDue
      : a.balanceCentavos > b.balanceCentavos
        ? -1
        : 1,
  );

  const page = paginate(aggs, query.page, query.pageSize);
  return {
    ...page,
    items: page.items.map((a) => ({
      serviceAccountId: a.serviceAccountId,
      subscriberId: a.subscriberId,
      accountNumber: a.accountNumber,
      subscriberName: a.subscriberName,
      serviceName: a.serviceName,
      collectionAreaName: a.collectionAreaName,
      collectorName: a.collectorName,
      daysPastDue: a.maxDaysPastDue,
      totalArrearsCentavos: centavosToString(a.balanceCentavos),
      status: a.serviceAccountStatus,
      oldestDueDate: a.oldestDueDate,
    })),
    thresholdCentavos: centavosToString(threshold),
    totals: {
      count: aggs.length,
      arrearsCentavos: centavosToString(
        aggs.reduce((s, a) => s + a.balanceCentavos, 0n),
      ),
    },
  };
}

export async function listSuspendedAccounts(
  db: Db,
  query: { page: number; pageSize: number },
) {
  const rows = await db
    .select({
      serviceAccountId: serviceAccounts.id,
      subscriberId: serviceAccounts.subscriberId,
      accountNumber: serviceAccounts.accountNumber,
      subscriberName: subscribers.fullName,
      serviceName: servicePlans.name,
      status: serviceAccounts.status,
      collectionAreaName: collectionAreas.name,
    })
    .from(serviceAccounts)
    .innerJoin(subscribers, eq(serviceAccounts.subscriberId, subscribers.id))
    .innerJoin(servicePlans, eq(serviceAccounts.servicePlanId, servicePlans.id))
    .leftJoin(
      collectionAreas,
      eq(subscribers.collectionAreaId, collectionAreas.id),
    )
    .where(eq(serviceAccounts.status, "SUSPENDED"))
    .orderBy(asc(serviceAccounts.accountNumber));

  // Attach latest open suspension + pending reconnection
  const saIds = rows.map((r) => r.serviceAccountId);
  const suspensions =
    saIds.length === 0
      ? []
      : await db
          .select()
          .from(suspensionRecords)
          .where(inArray(suspensionRecords.serviceAccountId, saIds))
          .orderBy(desc(suspensionRecords.createdAt));
  const latestSusp = new Map<string, (typeof suspensions)[number]>();
  for (const s of suspensions) {
    if (!latestSusp.has(s.serviceAccountId)) {
      latestSusp.set(s.serviceAccountId, s);
    }
  }

  const reconns =
    saIds.length === 0
      ? []
      : await db
          .select()
          .from(reconnectionRecords)
          .where(
            and(
              inArray(reconnectionRecords.serviceAccountId, saIds),
              eq(reconnectionRecords.status, "PENDING"),
            ),
          )
          .orderBy(desc(reconnectionRecords.createdAt));
  const pendingReconn = new Map<string, (typeof reconns)[number]>();
  for (const r of reconns) {
    if (!pendingReconn.has(r.serviceAccountId)) {
      pendingReconn.set(r.serviceAccountId, r);
    }
  }

  const enriched = rows.map((r) => {
    const susp = latestSusp.get(r.serviceAccountId);
    const recon = pendingReconn.get(r.serviceAccountId);
    return {
      serviceAccountId: r.serviceAccountId,
      subscriberId: r.subscriberId,
      accountNumber: r.accountNumber,
      subscriberName: r.subscriberName,
      serviceName: r.serviceName,
      collectionAreaName: r.collectionAreaName,
      status: r.status,
      latestSuspensionId: susp?.id ?? null,
      suspensionReason: susp?.reason ?? null,
      suspensionEffectiveDate: susp?.effectiveDate ?? null,
      pendingReconnectionId: recon?.id ?? null,
      pendingReconnectionFeeCentavos: recon
        ? centavosToString(recon.feeCentavos)
        : null,
    };
  });

  return paginate(enriched, query.page, query.pageSize);
}

export async function listSuspensionHistory(
  db: Db,
  query: SuspensionHistoryQuery,
) {
  const suspRows = await db
    .select({
      id: suspensionRecords.id,
      serviceAccountId: suspensionRecords.serviceAccountId,
      accountNumber: serviceAccounts.accountNumber,
      subscriberName: subscribers.fullName,
      reason: suspensionRecords.reason,
      effectiveDate: suspensionRecords.effectiveDate,
      notes: suspensionRecords.notes,
      createdAt: suspensionRecords.createdAt,
    })
    .from(suspensionRecords)
    .innerJoin(
      serviceAccounts,
      eq(suspensionRecords.serviceAccountId, serviceAccounts.id),
    )
    .innerJoin(subscribers, eq(serviceAccounts.subscriberId, subscribers.id));

  const reconRows = await db
    .select({
      id: reconnectionRecords.id,
      serviceAccountId: reconnectionRecords.serviceAccountId,
      accountNumber: serviceAccounts.accountNumber,
      subscriberName: subscribers.fullName,
      status: reconnectionRecords.status,
      feeCentavos: reconnectionRecords.feeCentavos,
      technicianUserId: reconnectionRecords.technicianUserId,
      requestedAt: reconnectionRecords.requestedAt,
      completedAt: reconnectionRecords.completedAt,
      notes: reconnectionRecords.notes,
      createdAt: reconnectionRecords.createdAt,
    })
    .from(reconnectionRecords)
    .innerJoin(
      serviceAccounts,
      eq(reconnectionRecords.serviceAccountId, serviceAccounts.id),
    )
    .innerJoin(subscribers, eq(serviceAccounts.subscriberId, subscribers.id));

  const combined = [
    ...suspRows.map((r) => ({
      id: r.id,
      kind: "SUSPENSION" as const,
      serviceAccountId: r.serviceAccountId,
      accountNumber: r.accountNumber,
      subscriberName: r.subscriberName,
      reason: r.reason,
      effectiveDate: r.effectiveDate as string | null,
      status: "RECORDED",
      feeCentavos: null as string | null,
      technicianUserId: null as string | null,
      requestedAt: r.createdAt.toISOString(),
      completedAt: null as string | null,
      notes: r.notes,
      createdAt: r.createdAt.toISOString(),
    })),
    ...reconRows.map((r) => ({
      id: r.id,
      kind: "RECONNECTION" as const,
      serviceAccountId: r.serviceAccountId,
      accountNumber: r.accountNumber,
      subscriberName: r.subscriberName,
      reason: r.notes,
      effectiveDate: null as string | null,
      status: r.status,
      feeCentavos: centavosToString(r.feeCentavos),
      technicianUserId: r.technicianUserId,
      requestedAt: r.requestedAt.toISOString(),
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      notes: r.notes,
      createdAt: r.createdAt.toISOString(),
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return paginate(combined, query.page, query.pageSize);
}
