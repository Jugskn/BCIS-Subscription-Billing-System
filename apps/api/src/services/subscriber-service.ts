import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import {
  collectionAreas,
  serviceAccounts,
  servicePlans,
  subscribers,
  users,
  type Database,
} from "@bcis/db";
import type {
  CreateSubscriberInput,
  UpdateSubscriberInput,
} from "@bcis/shared";
import { centavosToString } from "@bcis/shared";
import { AppError } from "../lib/errors.js";
import { writeAuditLog } from "../lib/audit.js";
import { nextAccountNumber } from "../lib/account-number.js";
import { recordServiceEvent } from "../lib/service-events.js";

function toListItem(
  row: typeof subscribers.$inferSelect,
  areaName: string | null,
  collectorName: string | null,
) {
  return {
    id: row.id,
    accountNumber: row.accountNumber,
    fullName: row.fullName,
    contactPhone: row.contactPhone,
    address: row.address,
    collectionAreaName: areaName,
    collectorName,
    dueDay: row.dueDay,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDetail(
  row: typeof subscribers.$inferSelect,
  areaName: string | null,
  collectorName: string | null,
) {
  return {
    ...toListItem(row, areaName, collectorName),
    contactEmail: row.contactEmail,
    collectionAreaId: row.collectionAreaId,
    collectorUserId: row.collectorUserId,
    notes: row.notes,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadSubscriberDetail(db: Database["db"], id: string) {
  const rows = await db
    .select({
      subscriber: subscribers,
      areaName: collectionAreas.name,
      collectorName: users.fullName,
    })
    .from(subscribers)
    .leftJoin(collectionAreas, eq(subscribers.collectionAreaId, collectionAreas.id))
    .leftJoin(users, eq(subscribers.collectorUserId, users.id))
    .where(eq(subscribers.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) throw new AppError(404, "NOT_FOUND", "Subscriber not found.");
  return toDetail(row.subscriber, row.areaName, row.collectorName);
}

export async function listSubscribers(
  db: Database["db"],
  query: {
    page: number;
    pageSize: number;
    search?: string;
    status?: string;
    collectionAreaId?: string;
  },
) {
  const offset = (query.page - 1) * query.pageSize;
  const filters = [];
  if (query.search) {
    filters.push(
      or(
        ilike(subscribers.accountNumber, `%${query.search}%`),
        ilike(subscribers.fullName, `%${query.search}%`),
        ilike(subscribers.contactPhone, `%${query.search}%`),
        ilike(subscribers.address, `%${query.search}%`),
      ),
    );
  }
  if (query.status) {
    filters.push(eq(subscribers.status, query.status as typeof subscribers.$inferSelect.status));
  }
  if (query.collectionAreaId) {
    filters.push(eq(subscribers.collectionAreaId, query.collectionAreaId));
  }
  const where = filters.length ? and(...filters) : undefined;

  const [totalRow] = await db
    .select({ value: count() })
    .from(subscribers)
    .where(where);

  const rows = await db
    .select({
      subscriber: subscribers,
      areaName: collectionAreas.name,
      collectorName: users.fullName,
    })
    .from(subscribers)
    .leftJoin(collectionAreas, eq(subscribers.collectionAreaId, collectionAreas.id))
    .leftJoin(users, eq(subscribers.collectorUserId, users.id))
    .where(where)
    .orderBy(desc(subscribers.createdAt))
    .limit(query.pageSize)
    .offset(offset);

  return {
    items: rows.map((r) =>
      toListItem(r.subscriber, r.areaName, r.collectorName),
    ),
    page: query.page,
    pageSize: query.pageSize,
    total: Number(totalRow?.value ?? 0),
  };
}

export async function globalSearchSubscribers(
  db: Database["db"],
  query: { q: string; page: number; pageSize: number },
) {
  const offset = (query.page - 1) * query.pageSize;
  const term = query.q.trim();

  const similarityExpr = sql`GREATEST(
    similarity(${subscribers.accountNumber}, ${term}),
    similarity(${subscribers.fullName}, ${term}),
    similarity(COALESCE(${subscribers.contactPhone}, ''), ${term}),
    similarity(${subscribers.address}, ${term})
  )`;

  const matchFilter = or(
    sql`${subscribers.accountNumber} % ${term}`,
    sql`${subscribers.fullName} % ${term}`,
    sql`COALESCE(${subscribers.contactPhone}, '') % ${term}`,
    sql`${subscribers.address} % ${term}`,
    ilike(subscribers.accountNumber, `%${term}%`),
    ilike(subscribers.fullName, `%${term}%`),
    ilike(subscribers.contactPhone, `%${term}%`),
    ilike(subscribers.address, `%${term}%`),
  );

  const [totalRow] = await db
    .select({ value: count() })
    .from(subscribers)
    .where(matchFilter);

  const rows = await db
    .select({
      subscriber: subscribers,
      areaName: collectionAreas.name,
      collectorName: users.fullName,
      rank: similarityExpr,
    })
    .from(subscribers)
    .leftJoin(collectionAreas, eq(subscribers.collectionAreaId, collectionAreas.id))
    .leftJoin(users, eq(subscribers.collectorUserId, users.id))
    .where(matchFilter)
    .orderBy(desc(similarityExpr), desc(subscribers.createdAt))
    .limit(query.pageSize)
    .offset(offset);

  return {
    items: rows.map((r) =>
      toListItem(r.subscriber, r.areaName, r.collectorName),
    ),
    page: query.page,
    pageSize: query.pageSize,
    total: Number(totalRow?.value ?? 0),
  };
}

export async function getSubscriber(db: Database["db"], id: string) {
  return loadSubscriberDetail(db, id);
}

export async function createSubscriber(
  db: Database["db"],
  actorUserId: string,
  input: CreateSubscriberInput,
) {
  if (input.collectionAreaId) {
    const area = await db
      .select({ id: collectionAreas.id })
      .from(collectionAreas)
      .where(eq(collectionAreas.id, input.collectionAreaId))
      .limit(1);
    if (!area[0]) {
      throw new AppError(400, "INVALID_AREA", "Collection area not found.");
    }
  }

  if (input.collectorUserId) {
    const collector = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.collectorUserId))
      .limit(1);
    if (!collector[0]) {
      throw new AppError(400, "INVALID_COLLECTOR", "Collector not found.");
    }
  }

  const planIds = [...new Set(input.servicePlanIds ?? [])];
  const planRows =
    planIds.length > 0
      ? await db
          .select({
            id: servicePlans.id,
            isActive: servicePlans.isActive,
            priceCentavos: servicePlans.priceCentavos,
          })
          .from(servicePlans)
          .where(inArray(servicePlans.id, planIds))
      : [];
  if (planRows.length !== planIds.length) {
    throw new AppError(400, "INVALID_PLAN", "One or more service plans were not found.");
  }
  if (planRows.some((p) => !p.isActive)) {
    throw new AppError(400, "PLAN_INACTIVE", "Cannot assign an inactive plan.");
  }
  const planById = new Map(planRows.map((p) => [p.id, p]));

  const today = new Date().toISOString().slice(0, 10);

  const created = await db.transaction(async (tx) => {
    const accountNumber = await nextAccountNumber(tx, "SUB");
    const [row] = await tx
      .insert(subscribers)
      .values({
        accountNumber,
        fullName: input.fullName,
        contactPhone: input.contactPhone || null,
        contactEmail: input.contactEmail || null,
        address: input.address,
        collectionAreaId: input.collectionAreaId ?? null,
        collectorUserId: input.collectorUserId ?? null,
        dueDay: input.dueDay,
        notes: input.notes ?? null,
        status: "ACTIVE",
      })
      .returning();
    if (!row) throw new AppError(500, "CREATE_FAILED", "Could not create subscriber.");

    await writeAuditLog(tx, {
      actorUserId,
      action: "subscriber.create",
      entityType: "subscriber",
      entityId: row.id,
      newValues: {
        accountNumber: row.accountNumber,
        fullName: row.fullName,
        status: row.status,
      },
    });

    for (const planId of planIds) {
      const plan = planById.get(planId)!;
      const saNumber = await nextAccountNumber(tx, "SVC");
      const [sa] = await tx
        .insert(serviceAccounts)
        .values({
          accountNumber: saNumber,
          subscriberId: row.id,
          servicePlanId: planId,
          installationAddress: row.address,
          activationDate: today,
          billingStartDate: today,
          dueDay: row.dueDay,
          currentRateCentavos: plan.priceCentavos,
          status: "ACTIVE",
          collectorUserId: row.collectorUserId,
        })
        .returning();
      if (!sa) {
        throw new AppError(500, "CREATE_FAILED", "Could not create service account.");
      }

      await recordServiceEvent(tx, {
        serviceAccountId: sa.id,
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
        entityId: sa.id,
        newValues: {
          accountNumber: sa.accountNumber,
          subscriberId: sa.subscriberId,
          planId,
          currentRateCentavos: centavosToString(sa.currentRateCentavos),
        },
      });
    }

    return row;
  });

  return loadSubscriberDetail(db, created.id);
}

export async function updateSubscriber(
  db: Database["db"],
  actorUserId: string,
  subscriberId: string,
  input: UpdateSubscriberInput,
) {
  const rows = await db
    .select()
    .from(subscribers)
    .where(eq(subscribers.id, subscriberId))
    .limit(1);
  const existing = rows[0];
  if (!existing) throw new AppError(404, "NOT_FOUND", "Subscriber not found.");

  if (input.collectionAreaId) {
    const area = await db
      .select({ id: collectionAreas.id })
      .from(collectionAreas)
      .where(eq(collectionAreas.id, input.collectionAreaId))
      .limit(1);
    if (!area[0]) {
      throw new AppError(400, "INVALID_AREA", "Collection area not found.");
    }
  }

  const statusChanging =
    input.status !== undefined && input.status !== existing.status;

  const [updated] = await db
    .update(subscribers)
    .set({
      ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
      ...(input.contactPhone !== undefined
        ? { contactPhone: input.contactPhone || null }
        : {}),
      ...(input.contactEmail !== undefined
        ? { contactEmail: input.contactEmail || null }
        : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.collectionAreaId !== undefined
        ? { collectionAreaId: input.collectionAreaId }
        : {}),
      ...(input.collectorUserId !== undefined
        ? { collectorUserId: input.collectorUserId }
        : {}),
      ...(input.dueDay !== undefined ? { dueDay: input.dueDay } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      updatedAt: new Date(),
    })
    .where(eq(subscribers.id, subscriberId))
    .returning();

  if (!updated) throw new AppError(500, "UPDATE_FAILED", "Could not update subscriber.");

  await writeAuditLog(db, {
    actorUserId,
    action: statusChanging ? "subscriber.status_change" : "subscriber.update",
    entityType: "subscriber",
    entityId: subscriberId,
    reason: input.statusReason ?? null,
    oldValues: {
      fullName: existing.fullName,
      status: existing.status,
    },
    newValues: {
      fullName: updated.fullName,
      status: updated.status,
    },
  });

  return loadSubscriberDetail(db, subscriberId);
}
