import { and, count, desc, eq, ilike } from "drizzle-orm";
import {
  serviceAccounts,
  serviceEvents,
  servicePlans,
  serviceTypes,
  subscribers,
  users,
  type Database,
} from "@bcis/db";
import type {
  CreateServiceAccountInput,
  UpdateServiceAccountInput,
} from "@bcis/shared";
import { centavosToString } from "@bcis/shared";
import { AppError } from "../lib/errors.js";
import { writeAuditLog } from "../lib/audit.js";
import { nextAccountNumber } from "../lib/account-number.js";
import { recordServiceEvent } from "../lib/service-events.js";

function toListItem(row: {
  account: typeof serviceAccounts.$inferSelect;
  subscriber: typeof subscribers.$inferSelect;
  plan: typeof servicePlans.$inferSelect;
  type: typeof serviceTypes.$inferSelect;
}) {
  return {
    id: row.account.id,
    accountNumber: row.account.accountNumber,
    subscriberId: row.subscriber.id,
    subscriberName: row.subscriber.fullName,
    subscriberAccountNumber: row.subscriber.accountNumber,
    planCode: row.plan.code,
    planName: row.plan.name,
    serviceTypeName: row.type.name,
    installationAddress: row.account.installationAddress,
    currentRateCentavos: centavosToString(row.account.currentRateCentavos),
    dueDay: row.account.dueDay,
    status: row.account.status,
    activationDate: row.account.activationDate,
    createdAt: row.account.createdAt.toISOString(),
  };
}

export async function listServiceAccounts(
  db: Database["db"],
  query: {
    page: number;
    pageSize: number;
    search?: string;
    subscriberId?: string;
    status?: string;
    servicePlanId?: string;
  },
) {
  const offset = (query.page - 1) * query.pageSize;
  const filters = [];
  if (query.search) {
    filters.push(
      ilike(serviceAccounts.accountNumber, `%${query.search}%`),
    );
  }
  if (query.subscriberId) {
    filters.push(eq(serviceAccounts.subscriberId, query.subscriberId));
  }
  if (query.status) {
    filters.push(
      eq(serviceAccounts.status, query.status as typeof serviceAccounts.$inferSelect.status),
    );
  }
  if (query.servicePlanId) {
    filters.push(eq(serviceAccounts.servicePlanId, query.servicePlanId));
  }
  const where = filters.length ? and(...filters) : undefined;

  const [totalRow] = await db
    .select({ value: count() })
    .from(serviceAccounts)
    .where(where);

  const rows = await db
    .select({
      account: serviceAccounts,
      subscriber: subscribers,
      plan: servicePlans,
      type: serviceTypes,
    })
    .from(serviceAccounts)
    .innerJoin(subscribers, eq(serviceAccounts.subscriberId, subscribers.id))
    .innerJoin(servicePlans, eq(serviceAccounts.servicePlanId, servicePlans.id))
    .innerJoin(serviceTypes, eq(servicePlans.serviceTypeId, serviceTypes.id))
    .where(where)
    .orderBy(desc(serviceAccounts.createdAt))
    .limit(query.pageSize)
    .offset(offset);

  return {
    items: rows.map(toListItem),
    page: query.page,
    pageSize: query.pageSize,
    total: Number(totalRow?.value ?? 0),
  };
}

export async function getServiceAccount(db: Database["db"], id: string) {
  const rows = await db
    .select({
      account: serviceAccounts,
      subscriber: subscribers,
      plan: servicePlans,
      type: serviceTypes,
    })
    .from(serviceAccounts)
    .innerJoin(subscribers, eq(serviceAccounts.subscriberId, subscribers.id))
    .innerJoin(servicePlans, eq(serviceAccounts.servicePlanId, servicePlans.id))
    .innerJoin(serviceTypes, eq(servicePlans.serviceTypeId, serviceTypes.id))
    .where(eq(serviceAccounts.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) throw new AppError(404, "NOT_FOUND", "Service account not found.");

  return {
    ...toListItem(row),
    billingStartDate: row.account.billingStartDate,
    collectorUserId: row.account.collectorUserId,
    planId: row.plan.id,
    updatedAt: row.account.updatedAt.toISOString(),
  };
}

export async function listServiceEvents(
  db: Database["db"],
  serviceAccountId: string,
) {
  const account = await db
    .select({ id: serviceAccounts.id })
    .from(serviceAccounts)
    .where(eq(serviceAccounts.id, serviceAccountId))
    .limit(1);
  if (!account[0]) {
    throw new AppError(404, "NOT_FOUND", "Service account not found.");
  }

  const rows = await db
    .select({
      event: serviceEvents,
      actorName: users.fullName,
    })
    .from(serviceEvents)
    .leftJoin(users, eq(serviceEvents.actorUserId, users.id))
    .where(eq(serviceEvents.serviceAccountId, serviceAccountId))
    .orderBy(desc(serviceEvents.createdAt));

  return rows.map((r) => ({
    id: r.event.id,
    eventType: r.event.eventType,
    oldStatus: r.event.oldStatus,
    newStatus: r.event.newStatus,
    reason: r.event.reason,
    actorName: r.actorName,
    createdAt: r.event.createdAt.toISOString(),
  }));
}

export async function createServiceAccount(
  db: Database["db"],
  actorUserId: string,
  input: CreateServiceAccountInput,
) {
  const sub = await db
    .select()
    .from(subscribers)
    .where(eq(subscribers.id, input.subscriberId))
    .limit(1);
  if (!sub[0]) throw new AppError(400, "INVALID_SUBSCRIBER", "Subscriber not found.");

  const planRows = await db
    .select({ plan: servicePlans, type: serviceTypes })
    .from(servicePlans)
    .innerJoin(serviceTypes, eq(servicePlans.serviceTypeId, serviceTypes.id))
    .where(eq(servicePlans.id, input.servicePlanId))
    .limit(1);
  const planRow = planRows[0];
  if (!planRow) throw new AppError(400, "INVALID_PLAN", "Service plan not found.");
  if (!planRow.plan.isActive) {
    throw new AppError(400, "PLAN_INACTIVE", "Cannot assign an inactive plan.");
  }

  const created = await db.transaction(async (tx) => {
    const accountNumber = await nextAccountNumber(tx, "SVC");
    const [row] = await tx
      .insert(serviceAccounts)
      .values({
        accountNumber,
        subscriberId: input.subscriberId,
        servicePlanId: input.servicePlanId,
        installationAddress: input.installationAddress,
        activationDate: input.activationDate,
        billingStartDate: input.billingStartDate,
        dueDay: input.dueDay,
        currentRateCentavos: planRow.plan.priceCentavos,
        status: "ACTIVE",
        collectorUserId: input.collectorUserId ?? sub[0]!.collectorUserId,
      })
      .returning();
    if (!row) throw new AppError(500, "CREATE_FAILED", "Could not create service account.");

    await recordServiceEvent(tx, {
      serviceAccountId: row.id,
      eventType: "STATUS_CHANGE",
      oldStatus: null,
      newStatus: "ACTIVE",
      reason: "Account created",
      actorUserId,
    });

    await writeAuditLog(tx, {
      actorUserId,
      action: "service_account.create",
      entityType: "service_account",
      entityId: row.id,
      newValues: {
        accountNumber: row.accountNumber,
        subscriberId: row.subscriberId,
        planId: input.servicePlanId,
        currentRateCentavos: centavosToString(row.currentRateCentavos),
      },
    });

    return row;
  });

  return getServiceAccount(db, created.id);
}

export async function updateServiceAccount(
  db: Database["db"],
  actorUserId: string,
  accountId: string,
  input: UpdateServiceAccountInput,
) {
  const rows = await db
    .select()
    .from(serviceAccounts)
    .where(eq(serviceAccounts.id, accountId))
    .limit(1);
  const existing = rows[0];
  if (!existing) throw new AppError(404, "NOT_FOUND", "Service account not found.");

  const statusChanging =
    input.status !== undefined && input.status !== existing.status;

  const [updated] = await db
    .update(serviceAccounts)
    .set({
      ...(input.installationAddress !== undefined
        ? { installationAddress: input.installationAddress }
        : {}),
      ...(input.dueDay !== undefined ? { dueDay: input.dueDay } : {}),
      ...(input.collectorUserId !== undefined
        ? { collectorUserId: input.collectorUserId }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      updatedAt: new Date(),
    })
    .where(eq(serviceAccounts.id, accountId))
    .returning();

  if (!updated) {
    throw new AppError(500, "UPDATE_FAILED", "Could not update service account.");
  }

  if (statusChanging) {
    await recordServiceEvent(db, {
      serviceAccountId: accountId,
      eventType: "STATUS_CHANGE",
      oldStatus: existing.status,
      newStatus: updated.status,
      reason: input.statusReason ?? null,
      actorUserId,
    });
  }

  await writeAuditLog(db, {
    actorUserId,
    action: statusChanging
      ? "service_account.status_change"
      : "service_account.update",
    entityType: "service_account",
    entityId: accountId,
    reason: input.statusReason ?? null,
    oldValues: { status: existing.status },
    newValues: { status: updated.status },
  });

  return getServiceAccount(db, accountId);
}
