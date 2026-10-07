import { and, eq, gt, inArray, ne, sql } from "drizzle-orm";
import {
  invoices,
  subscribers,
  type Database,
} from "@bcis/db";
import {
  centavosToString,
  computeArAging,
  computeOverdueStatus,
} from "@bcis/shared";
import { getGraceDays } from "./settings-service.js";

const OPEN_STATUSES = ["UNPAID", "PARTIALLY_PAID", "OVERDUE"] as const;

type Db = Database["db"];

function todayIso(asOf?: string): string {
  if (asOf) return asOf;
  return new Date().toISOString().slice(0, 10);
}

/** Open invoices with positive balance (shared by aging, dashboard, reports). */
export async function loadOpenInvoicesForAging(
  db: Db,
  filters?: {
    collectionAreaId?: string;
    collectorUserId?: string;
  },
) {
  const conditions = [
    inArray(invoices.status, [...OPEN_STATUSES]),
    gt(invoices.balanceCentavos, 0n),
    ne(invoices.status, "VOID"),
  ];

  const rows = await db
    .select({
      id: invoices.id,
      balanceCentavos: invoices.balanceCentavos,
      dueDate: invoices.dueDate,
      status: invoices.status,
      subscriberId: invoices.subscriberId,
      collectionAreaId: subscribers.collectionAreaId,
      collectorUserId: subscribers.collectorUserId,
    })
    .from(invoices)
    .innerJoin(subscribers, eq(invoices.subscriberId, subscribers.id))
    .where(and(...conditions));

  return rows.filter((r) => {
    if (
      filters?.collectionAreaId &&
      r.collectionAreaId !== filters.collectionAreaId
    ) {
      return false;
    }
    if (
      filters?.collectorUserId &&
      r.collectorUserId !== filters.collectorUserId
    ) {
      return false;
    }
    return true;
  });
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
  totalOpenCentavos: bigint;
}> {
  const today = todayIso(asOfDate);
  const graceDays = await getGraceDays(db);
  const open = await loadOpenInvoicesForAging(db);

  let currentReceivableCentavos = 0n;
  let overdueReceivableCentavos = 0n;
  const overdueSubscribers = new Set<string>();

  for (const inv of open) {
    const status = computeOverdueStatus(
      inv.dueDate,
      graceDays,
      today,
      inv.status === "OVERDUE" ? "UNPAID" : inv.status,
    );
    if (status === "OVERDUE") {
      overdueReceivableCentavos += inv.balanceCentavos;
      overdueSubscribers.add(inv.subscriberId);
    } else {
      currentReceivableCentavos += inv.balanceCentavos;
    }
  }

  return {
    currentReceivableCentavos,
    overdueReceivableCentavos,
    subscribersOverdueCount: overdueSubscribers.size,
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
      inv.status === "OVERDUE" ? "UNPAID" : inv.status,
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
