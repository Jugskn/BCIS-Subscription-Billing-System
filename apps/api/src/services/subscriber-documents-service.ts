import { and, count, desc, eq, inArray, or } from "drizzle-orm";
import {
  auditLogs,
  invoices,
  paymentProofs,
  payments,
  receipts,
  serviceAccounts,
  subscribers,
  users,
  type Database,
} from "@bcis/db";
import { AppError } from "../lib/errors.js";

type Db = Database["db"];

async function assertSubscriberExists(db: Db, subscriberId: string) {
  const [row] = await db
    .select({ id: subscribers.id })
    .from(subscribers)
    .where(eq(subscribers.id, subscriberId))
    .limit(1);
  if (!row) {
    throw new AppError(404, "NOT_FOUND", "Subscriber not found.");
  }
}

export async function listSubscriberDocuments(
  db: Db,
  subscriberId: string,
  query: { page: number; pageSize: number },
) {
  await assertSubscriberExists(db, subscriberId);

  const receiptRows = await db
    .select({
      id: receipts.id,
      receiptNumber: receipts.receiptNumber,
      status: receipts.status,
      amountCentavos: receipts.amountCentavos,
      issuedAt: receipts.issuedAt,
      voidedAt: receipts.voidedAt,
      paymentId: receipts.paymentId,
    })
    .from(receipts)
    .where(eq(receipts.subscriberId, subscriberId))
    .orderBy(desc(receipts.issuedAt));

  const proofRows = await db
    .select({
      id: paymentProofs.id,
      paymentId: paymentProofs.paymentId,
      originalFilename: paymentProofs.originalFilename,
      mimeType: paymentProofs.mimeType,
      sizeBytes: paymentProofs.sizeBytes,
      createdAt: paymentProofs.createdAt,
      paymentStatus: payments.status,
      referenceNumber: payments.referenceNumber,
      verifierName: users.fullName,
      verifiedAt: payments.verifiedAt,
    })
    .from(paymentProofs)
    .innerJoin(payments, eq(paymentProofs.paymentId, payments.id))
    .leftJoin(users, eq(payments.verifiedBy, users.id))
    .where(eq(payments.subscriberId, subscriberId))
    .orderBy(desc(paymentProofs.createdAt));

  const items = [
    ...receiptRows.map((r) => ({
      kind: "receipt" as const,
      id: r.id,
      label: r.receiptNumber,
      status: r.status,
      amountCentavos: r.amountCentavos.toString(),
      at: r.issuedAt.toISOString(),
      paymentId: r.paymentId,
      voided: r.status === "VOID",
      mimeType: null as string | null,
      verifierName: null as string | null,
    })),
    ...proofRows.map((p) => ({
      kind: "gcash_proof" as const,
      id: p.id,
      label: p.originalFilename,
      status: p.paymentStatus,
      amountCentavos: null as string | null,
      at: p.createdAt.toISOString(),
      paymentId: p.paymentId,
      voided: false,
      mimeType: p.mimeType,
      verifierName: p.verifierName ?? null,
      referenceNumber: p.referenceNumber,
      verifiedAt: p.verifiedAt?.toISOString() ?? null,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const total = items.length;
  const offset = (query.page - 1) * query.pageSize;
  return {
    items: items.slice(offset, offset + query.pageSize),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

export async function listSubscriberAudit(
  db: Db,
  subscriberId: string,
  query: { page: number; pageSize: number },
) {
  await assertSubscriberExists(db, subscriberId);

  const saRows = await db
    .select({ id: serviceAccounts.id })
    .from(serviceAccounts)
    .where(eq(serviceAccounts.subscriberId, subscriberId));
  const saIds = saRows.map((r) => r.id);

  const invRows =
    saIds.length === 0
      ? []
      : await db
          .select({ id: invoices.id })
          .from(invoices)
          .where(eq(invoices.subscriberId, subscriberId));
  const invIds = invRows.map((r) => r.id);

  const payRows = await db
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.subscriberId, subscriberId));
  const payIds = payRows.map((r) => r.id);

  const entityFilters = [
    and(
      eq(auditLogs.entityType, "subscriber"),
      eq(auditLogs.entityId, subscriberId),
    ),
  ];
  if (saIds.length > 0) {
    entityFilters.push(
      and(
        eq(auditLogs.entityType, "service_account"),
        inArray(auditLogs.entityId, saIds),
      ),
    );
  }
  if (invIds.length > 0) {
    entityFilters.push(
      and(eq(auditLogs.entityType, "invoice"), inArray(auditLogs.entityId, invIds)),
    );
  }
  if (payIds.length > 0) {
    entityFilters.push(
      and(eq(auditLogs.entityType, "payment"), inArray(auditLogs.entityId, payIds)),
    );
  }

  const where = or(...entityFilters);

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
      oldValues: auditLogs.oldValues,
      newValues: auditLogs.newValues,
      createdAt: auditLogs.createdAt,
      actorName: users.fullName,
      actorUserId: auditLogs.actorUserId,
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorUserId, users.id))
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(query.pageSize)
    .offset(offset);

  return {
    items: rows.map((r) => ({
      id: r.id,
      actorName: r.actorName ?? "",
      actorUserId: r.actorUserId,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      reason: r.reason,
      at: r.createdAt.toISOString(),
      oldSummary: summarizeValues(r.oldValues),
      newSummary: summarizeValues(r.newValues),
    })),
    page: query.page,
    pageSize: query.pageSize,
    total: Number(totalRow?.total ?? 0),
  };
}

function summarizeValues(
  values: Record<string, unknown> | null | undefined,
): string {
  if (!values || Object.keys(values).length === 0) return "";
  try {
    const entries = Object.entries(values).slice(0, 6);
    return entries
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join("; ");
  } catch {
    return "";
  }
}
