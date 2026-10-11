import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  or,
  sql,
} from "drizzle-orm";
import {
  collectionAreas,
  collectionBatchAccounts,
  collectionBatches,
  collectorAssignments,
  roles,
  subscribers,
  userRoles,
  users,
  type Database,
} from "@bcis/db";
import {
  centavosToString,
  type CollectionBatchListQuery,
  type CollectionBatchStatus,
  type CollectorAreaAssignmentInput,
  type CreateCollectionBatchInput,
  type RecordBatchCollectionInput,
  type RemitBatchInput,
} from "@bcis/shared";
import { AppError } from "../lib/errors.js";
import { writeAuditLog } from "../lib/audit.js";
import { nextAccountNumber } from "../lib/account-number.js";

const TRANSITIONS: Record<CollectionBatchStatus, CollectionBatchStatus[]> = {
  OPEN: ["IN_PROGRESS"],
  IN_PROGRESS: ["SUBMITTED"],
  SUBMITTED: ["REMITTED"],
  REMITTED: ["RECONCILED"],
  RECONCILED: ["CLOSED"],
  CLOSED: [],
};

function toDetail(
  batch: typeof collectionBatches.$inferSelect,
  collectorName: string | null,
  areaName: string | null,
  accountCount: number,
) {
  return {
    id: batch.id,
    batchNumber: batch.batchNumber,
    collectorUserId: batch.collectorUserId,
    collectorName,
    collectionAreaId: batch.collectionAreaId,
    collectionAreaName: areaName,
    status: batch.status,
    accountCount,
    expectedCashCentavos: centavosToString(batch.expectedCashCentavos),
    collectedCashCentavos: centavosToString(batch.collectedCashCentavos),
    collectedNonCashCentavos: centavosToString(batch.collectedNonCashCentavos),
    remittedCashCentavos:
      batch.remittedCashCentavos === null
        ? null
        : centavosToString(batch.remittedCashCentavos),
    differenceCentavos:
      batch.differenceCentavos === null
        ? null
        : centavosToString(batch.differenceCentavos),
    shortageReason: batch.shortageReason,
    notes: batch.notes,
    closedAt: batch.closedAt?.toISOString() ?? null,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
  };
}

async function loadBatch(db: Database["db"], id: string) {
  const rows = await db
    .select({
      batch: collectionBatches,
      collectorName: users.fullName,
      areaName: collectionAreas.name,
      accountCount: count(collectionBatchAccounts.id),
    })
    .from(collectionBatches)
    .leftJoin(users, eq(collectionBatches.collectorUserId, users.id))
    .leftJoin(
      collectionAreas,
      eq(collectionBatches.collectionAreaId, collectionAreas.id),
    )
    .leftJoin(
      collectionBatchAccounts,
      eq(collectionBatchAccounts.batchId, collectionBatches.id),
    )
    .where(eq(collectionBatches.id, id))
    .groupBy(collectionBatches.id, users.fullName, collectionAreas.name)
    .limit(1);
  const row = rows[0];
  if (!row) throw new AppError(404, "NOT_FOUND", "Collection batch not found.");
  return toDetail(
    row.batch,
    row.collectorName,
    row.areaName,
    Number(row.accountCount),
  );
}

function assertTransition(
  from: CollectionBatchStatus,
  to: CollectionBatchStatus,
) {
  if (!TRANSITIONS[from].includes(to)) {
    throw new AppError(
      409,
      "INVALID_STATE",
      `Cannot move batch from ${from} to ${to}.`,
    );
  }
}

export async function listCollectionBatches(
  db: Database["db"],
  query: CollectionBatchListQuery,
) {
  const offset = (query.page - 1) * query.pageSize;
  const filters = [];
  if (query.status) filters.push(eq(collectionBatches.status, query.status));
  if (query.collectorUserId) {
    filters.push(eq(collectionBatches.collectorUserId, query.collectorUserId));
  }
  if (query.collectionAreaId) {
    filters.push(eq(collectionBatches.collectionAreaId, query.collectionAreaId));
  }
  const where = filters.length ? and(...filters) : undefined;

  const [totalRow] = await db
    .select({ value: count() })
    .from(collectionBatches)
    .where(where);

  const rows = await db
    .select({
      batch: collectionBatches,
      collectorName: users.fullName,
      areaName: collectionAreas.name,
      accountCount: sql<number>`(
        select count(*)::int
        from ${collectionBatchAccounts}
        where ${collectionBatchAccounts.batchId} = ${collectionBatches.id}
      )`,
    })
    .from(collectionBatches)
    .leftJoin(users, eq(collectionBatches.collectorUserId, users.id))
    .leftJoin(
      collectionAreas,
      eq(collectionBatches.collectionAreaId, collectionAreas.id),
    )
    .where(where)
    .orderBy(desc(collectionBatches.createdAt))
    .limit(query.pageSize)
    .offset(offset);

  return {
    items: rows.map((r) =>
      toDetail(r.batch, r.collectorName, r.areaName, Number(r.accountCount)),
    ),
    page: query.page,
    pageSize: query.pageSize,
    total: Number(totalRow?.value ?? 0),
  };
}

export async function getCollectionBatch(db: Database["db"], id: string) {
  const detail = await loadBatch(db, id);
  const accounts = await db
    .select({
      account: collectionBatchAccounts,
      subscriberAccountNumber: subscribers.accountNumber,
      subscriberName: subscribers.fullName,
      subscriberAddress: subscribers.address,
    })
    .from(collectionBatchAccounts)
    .innerJoin(
      subscribers,
      eq(collectionBatchAccounts.subscriberId, subscribers.id),
    )
    .where(eq(collectionBatchAccounts.batchId, id));
  return {
    ...detail,
    accounts: accounts.map((row) => ({
      id: row.account.id,
      subscriberId: row.account.subscriberId,
      subscriberAccountNumber: row.subscriberAccountNumber,
      subscriberName: row.subscriberName,
      subscriberAddress: row.subscriberAddress,
      serviceAccountId: row.account.serviceAccountId,
      expectedCentavos: centavosToString(row.account.expectedCentavos),
      collectedCentavos: centavosToString(row.account.collectedCentavos),
      paymentId: row.account.paymentId,
      notes: row.account.notes,
    })),
  };
}

export async function listCollectorSummaries(
  db: Database["db"],
  query: { page: number; pageSize: number; search?: string },
) {
  const filters = [eq(users.isActive, true), eq(roles.name, "Collector")];
  if (query.search) {
    filters.push(
      or(
        ilike(users.fullName, `%${query.search}%`),
        ilike(users.username, `%${query.search}%`),
      )!,
    );
  }
  const where = and(...filters);
  const offset = (query.page - 1) * query.pageSize;

  const [totalRow] = await db
    .select({ value: countDistinct(users.id) })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(where);

  const collectors = await db
    .selectDistinct({
      collectorUserId: users.id,
      collectorName: users.fullName,
      username: users.username,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(where)
    .orderBy(asc(users.fullName))
    .limit(query.pageSize)
    .offset(offset);

  const collectorIds = collectors.map((collector) => collector.collectorUserId);
  if (collectorIds.length === 0) {
    return {
      items: [],
      page: query.page,
      pageSize: query.pageSize,
      total: Number(totalRow?.value ?? 0),
    };
  }

  const [assignments, subscriberCounts, batchTotals] = await Promise.all([
    db
      .select({
        collectorUserId: collectorAssignments.collectorUserId,
        id: collectionAreas.id,
        code: collectionAreas.code,
        name: collectionAreas.name,
      })
      .from(collectorAssignments)
      .innerJoin(
        collectionAreas,
        eq(collectorAssignments.collectionAreaId, collectionAreas.id),
      )
      .where(
        and(
          inArray(collectorAssignments.collectorUserId, collectorIds),
          eq(collectorAssignments.isActive, true),
        ),
      )
      .orderBy(asc(collectionAreas.code)),
    db
      .select({
        collectorUserId: subscribers.collectorUserId,
        value: count(),
      })
      .from(subscribers)
      .where(inArray(subscribers.collectorUserId, collectorIds))
      .groupBy(subscribers.collectorUserId),
    db
      .select({
        collectorUserId: collectionBatches.collectorUserId,
        openBatchCount: sql<number>`count(*) filter (
          where ${collectionBatches.status} <> 'CLOSED'
        )::int`,
        currentMonthCollectedCentavos: sql<string>`coalesce(sum(
          ${collectionBatches.collectedCashCentavos} +
          ${collectionBatches.collectedNonCashCentavos}
        ) filter (where ${gte(collectionBatches.createdAt, monthStartUtc())}), 0)`,
        remittanceDifferenceCentavos: sql<string>`coalesce(sum(
          ${collectionBatches.differenceCentavos}
        ), 0)`,
      })
      .from(collectionBatches)
      .where(inArray(collectionBatches.collectorUserId, collectorIds))
      .groupBy(collectionBatches.collectorUserId),
  ]);

  return {
    items: collectors.map((collector) => {
      const totals = batchTotals.find(
        (row) => row.collectorUserId === collector.collectorUserId,
      );
      return {
        ...collector,
        assignedAreas: assignments
          .filter(
            (assignment) =>
              assignment.collectorUserId === collector.collectorUserId,
          )
          .map(({ id, code, name }) => ({ id, code, name })),
        subscriberCount: Number(
          subscriberCounts.find(
            (row) => row.collectorUserId === collector.collectorUserId,
          )?.value ?? 0,
        ),
        openBatchCount: Number(totals?.openBatchCount ?? 0),
        currentMonthCollectedCentavos: centavosToString(
          BigInt(totals?.currentMonthCollectedCentavos ?? 0),
        ),
        remittanceDifferenceCentavos: centavosToString(
          BigInt(totals?.remittanceDifferenceCentavos ?? 0),
        ),
      };
    }),
    page: query.page,
    pageSize: query.pageSize,
    total: Number(totalRow?.value ?? 0),
  };
}

function monthStartUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function assertActiveCollector(db: Database["db"], collectorUserId: string) {
  const [collector] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(
      and(
        eq(users.id, collectorUserId),
        eq(users.isActive, true),
        eq(roles.name, "Collector"),
      ),
    )
    .limit(1);
  if (!collector) {
    throw new AppError(
      400,
      "INVALID_COLLECTOR",
      "An active user with the Collector role is required.",
    );
  }
}

export async function assignCollectorArea(
  db: Database["db"],
  actorUserId: string,
  collectorUserId: string,
  input: CollectorAreaAssignmentInput,
) {
  await assertActiveCollector(db, collectorUserId);
  const [area] = await db
    .select({ id: collectionAreas.id })
    .from(collectionAreas)
    .where(
      and(
        eq(collectionAreas.id, input.collectionAreaId),
        eq(collectionAreas.isActive, true),
      ),
    )
    .limit(1);
  if (!area) {
    throw new AppError(
      400,
      "INVALID_COLLECTION_AREA",
      "An active collection area is required.",
    );
  }

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(collectorAssignments)
      .where(
        and(
          eq(collectorAssignments.collectorUserId, collectorUserId),
          eq(collectorAssignments.collectionAreaId, input.collectionAreaId),
        ),
      )
      .orderBy(desc(collectorAssignments.assignedAt))
      .limit(1);
    if (existing?.isActive) {
      throw new AppError(
        409,
        "ALREADY_ASSIGNED",
        "This area is already assigned to the collector.",
      );
    }
    if (existing) {
      await tx
        .update(collectorAssignments)
        .set({ isActive: true, assignedAt: new Date() })
        .where(eq(collectorAssignments.id, existing.id));
    } else {
      await tx.insert(collectorAssignments).values({
        collectorUserId,
        collectionAreaId: input.collectionAreaId,
      });
    }
    await writeAuditLog(tx, {
      actorUserId,
      action: "collector_area.assign",
      entityType: "collector_assignment",
      entityId: `${collectorUserId}:${input.collectionAreaId}`,
      newValues: {
        collectorUserId,
        collectionAreaId: input.collectionAreaId,
        isActive: true,
      },
    });
  });
  return { ok: true };
}

export async function unassignCollectorArea(
  db: Database["db"],
  actorUserId: string,
  collectorUserId: string,
  collectionAreaId: string,
) {
  await assertActiveCollector(db, collectorUserId);
  await db.transaction(async (tx) => {
    const [assignment] = await tx
      .select()
      .from(collectorAssignments)
      .where(
        and(
          eq(collectorAssignments.collectorUserId, collectorUserId),
          eq(collectorAssignments.collectionAreaId, collectionAreaId),
          eq(collectorAssignments.isActive, true),
        ),
      )
      .orderBy(desc(collectorAssignments.assignedAt))
      .limit(1);
    if (!assignment) {
      throw new AppError(
        404,
        "NOT_FOUND",
        "Active collector area assignment not found.",
      );
    }
    await tx
      .update(collectorAssignments)
      .set({ isActive: false })
      .where(eq(collectorAssignments.id, assignment.id));
    await writeAuditLog(tx, {
      actorUserId,
      action: "collector_area.unassign",
      entityType: "collector_assignment",
      entityId: assignment.id,
      oldValues: {
        collectorUserId,
        collectionAreaId,
        isActive: true,
      },
      newValues: { isActive: false },
    });
  });
  return { ok: true };
}

export async function getSubscriberCollectionHistory(
  db: Database["db"],
  subscriberId: string,
  query: { page: number; pageSize: number },
) {
  const [subscriber] = await db
    .select({
      id: subscribers.id,
      accountNumber: subscribers.accountNumber,
      subscriberName: subscribers.fullName,
      areaId: collectionAreas.id,
      areaCode: collectionAreas.code,
      areaName: collectionAreas.name,
      collectorId: users.id,
      collectorName: users.fullName,
    })
    .from(subscribers)
    .leftJoin(
      collectionAreas,
      eq(subscribers.collectionAreaId, collectionAreas.id),
    )
    .leftJoin(users, eq(subscribers.collectorUserId, users.id))
    .where(eq(subscribers.id, subscriberId))
    .limit(1);
  if (!subscriber) {
    throw new AppError(404, "NOT_FOUND", "Subscriber not found.");
  }

  const [totalRow] = await db
    .select({ value: count() })
    .from(collectionBatchAccounts)
    .where(eq(collectionBatchAccounts.subscriberId, subscriberId));
  const rows = await db
    .select({
      account: collectionBatchAccounts,
      batch: collectionBatches,
      collectorName: users.fullName,
      areaName: collectionAreas.name,
    })
    .from(collectionBatchAccounts)
    .innerJoin(
      collectionBatches,
      eq(collectionBatchAccounts.batchId, collectionBatches.id),
    )
    .leftJoin(users, eq(collectionBatches.collectorUserId, users.id))
    .leftJoin(
      collectionAreas,
      eq(collectionBatches.collectionAreaId, collectionAreas.id),
    )
    .where(eq(collectionBatchAccounts.subscriberId, subscriberId))
    .orderBy(desc(collectionBatchAccounts.createdAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return {
    subscriberId: subscriber.id,
    accountNumber: subscriber.accountNumber,
    subscriberName: subscriber.subscriberName,
    assignedArea:
      subscriber.areaId && subscriber.areaCode && subscriber.areaName
        ? {
            id: subscriber.areaId,
            code: subscriber.areaCode,
            name: subscriber.areaName,
          }
        : null,
    assignedCollector:
      subscriber.collectorId && subscriber.collectorName
        ? { id: subscriber.collectorId, name: subscriber.collectorName }
        : null,
    items: rows.map((row) => ({
      batchAccountId: row.account.id,
      batchId: row.batch.id,
      batchNumber: row.batch.batchNumber,
      batchStatus: row.batch.status,
      collectorUserId: row.batch.collectorUserId,
      collectorName: row.collectorName,
      collectionAreaId: row.batch.collectionAreaId,
      collectionAreaName: row.areaName,
      expectedCentavos: centavosToString(row.account.expectedCentavos),
      collectedCentavos: centavosToString(row.account.collectedCentavos),
      paymentId: row.account.paymentId,
      notes: row.account.notes,
      recordedAt: row.account.createdAt.toISOString(),
    })),
    page: query.page,
    pageSize: query.pageSize,
    total: Number(totalRow?.value ?? 0),
  };
}

export async function createCollectionBatch(
  db: Database["db"],
  actorUserId: string,
  input: CreateCollectionBatchInput,
) {
  const [collector] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, input.collectorUserId))
    .limit(1);
  if (!collector) {
    throw new AppError(400, "INVALID_COLLECTOR", "Collector not found.");
  }

  let expectedTotal = 0n;
  for (const acct of input.accounts) {
    expectedTotal += BigInt(acct.expectedCentavos);
  }

  const created = await db.transaction(async (tx) => {
    const batchNumber = await nextAccountNumber(tx, "BATCH");
    const [batch] = await tx
      .insert(collectionBatches)
      .values({
        batchNumber,
        collectorUserId: input.collectorUserId,
        collectionAreaId: input.collectionAreaId ?? null,
        expectedCashCentavos: expectedTotal,
        notes: input.notes ?? null,
        createdBy: actorUserId,
        status: "OPEN",
      })
      .returning();
    if (!batch) {
      throw new AppError(500, "CREATE_FAILED", "Could not create collection batch.");
    }

    if (input.accounts.length > 0) {
      await tx.insert(collectionBatchAccounts).values(
        input.accounts.map((a) => ({
          batchId: batch.id,
          subscriberId: a.subscriberId,
          serviceAccountId: a.serviceAccountId ?? null,
          expectedCentavos: BigInt(a.expectedCentavos),
        })),
      );
    }

    await writeAuditLog(tx, {
      actorUserId,
      action: "collection_batch.create",
      entityType: "collection_batch",
      entityId: batch.id,
      newValues: {
        batchNumber,
        collectorUserId: input.collectorUserId,
        expectedCashCentavos: centavosToString(expectedTotal),
      },
    });

    return batch;
  });

  return getCollectionBatch(db, created.id);
}

export async function startCollectionBatch(
  db: Database["db"],
  actorUserId: string,
  batchId: string,
) {
  return transitionBatch(db, actorUserId, batchId, "IN_PROGRESS");
}

export async function submitCollectionBatch(
  db: Database["db"],
  actorUserId: string,
  batchId: string,
) {
  return transitionBatch(db, actorUserId, batchId, "SUBMITTED");
}

export async function recordBatchCollection(
  db: Database["db"],
  actorUserId: string,
  batchId: string,
  input: RecordBatchCollectionInput,
) {
  const [batch] = await db
    .select()
    .from(collectionBatches)
    .where(eq(collectionBatches.id, batchId))
    .limit(1);
  if (!batch) throw new AppError(404, "NOT_FOUND", "Collection batch not found.");
  if (batch.status !== "OPEN" && batch.status !== "IN_PROGRESS") {
    throw new AppError(
      409,
      "INVALID_STATE",
      "Collections can only be recorded on OPEN or IN_PROGRESS batches.",
    );
  }

  const collected = BigInt(input.collectedCentavos);
  await db.transaction(async (tx) => {
    const [existingAccount] = await tx
      .select()
      .from(collectionBatchAccounts)
      .where(
        and(
          eq(collectionBatchAccounts.batchId, batchId),
          eq(collectionBatchAccounts.subscriberId, input.subscriberId),
        ),
      )
      .orderBy(asc(collectionBatchAccounts.createdAt))
      .limit(1);

    if (existingAccount) {
      await tx
        .update(collectionBatchAccounts)
        .set({
          serviceAccountId:
            input.serviceAccountId ?? existingAccount.serviceAccountId,
          collectedCentavos: collected,
          paymentId: input.paymentId ?? null,
          notes: input.notes ?? existingAccount.notes,
        })
        .where(eq(collectionBatchAccounts.id, existingAccount.id));
    } else {
      await tx.insert(collectionBatchAccounts).values({
        batchId,
        subscriberId: input.subscriberId,
        serviceAccountId: input.serviceAccountId ?? null,
        expectedCentavos: collected,
        collectedCentavos: collected,
        paymentId: input.paymentId ?? null,
        notes: input.notes ?? null,
      });
    }

    const previousCollected = existingAccount?.collectedCentavos ?? 0n;
    const collectedDelta = collected - previousCollected;
    const cashAdd = input.isCash ? collectedDelta : 0n;
    const nonCashAdd = input.isCash ? 0n : collectedDelta;
    await tx
      .update(collectionBatches)
      .set({
        status: batch.status === "OPEN" ? "IN_PROGRESS" : batch.status,
        collectedCashCentavos: batch.collectedCashCentavos + cashAdd,
        collectedNonCashCentavos: batch.collectedNonCashCentavos + nonCashAdd,
        updatedAt: new Date(),
      })
      .where(eq(collectionBatches.id, batchId));

    await writeAuditLog(tx, {
      actorUserId,
      action: "collection_batch.record_collection",
      entityType: "collection_batch",
      entityId: batchId,
      newValues: {
        subscriberId: input.subscriberId,
        collectedCentavos: centavosToString(collected),
        isCash: input.isCash,
      },
    });
  });

  return getCollectionBatch(db, batchId);
}

export async function remitCollectionBatch(
  db: Database["db"],
  actorUserId: string,
  batchId: string,
  input: RemitBatchInput,
) {
  const [batch] = await db
    .select()
    .from(collectionBatches)
    .where(eq(collectionBatches.id, batchId))
    .limit(1);
  if (!batch) throw new AppError(404, "NOT_FOUND", "Collection batch not found.");
  assertTransition(batch.status as CollectionBatchStatus, "REMITTED");

  const remitted = BigInt(input.remittedCashCentavos);
  const difference = remitted - batch.collectedCashCentavos;
  if (difference !== 0n && !input.shortageReason) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "A shortage/overage reason is required when remittance differs from cash collected.",
    );
  }

  await db
    .update(collectionBatches)
    .set({
      status: "REMITTED",
      remittedCashCentavos: remitted,
      differenceCentavos: difference,
      shortageReason: input.shortageReason ?? null,
      updatedAt: new Date(),
    })
    .where(eq(collectionBatches.id, batchId));

  await writeAuditLog(db, {
    actorUserId,
    action: "collection_batch.remit",
    entityType: "collection_batch",
    entityId: batchId,
    reason: input.shortageReason ?? null,
    newValues: {
      remittedCashCentavos: centavosToString(remitted),
      differenceCentavos: centavosToString(difference),
    },
  });

  return getCollectionBatch(db, batchId);
}

export async function reconcileCollectionBatch(
  db: Database["db"],
  actorUserId: string,
  batchId: string,
) {
  return transitionBatch(db, actorUserId, batchId, "RECONCILED");
}

export async function closeCollectionBatch(
  db: Database["db"],
  actorUserId: string,
  batchId: string,
) {
  const [batch] = await db
    .select()
    .from(collectionBatches)
    .where(eq(collectionBatches.id, batchId))
    .limit(1);
  if (!batch) throw new AppError(404, "NOT_FOUND", "Collection batch not found.");
  assertTransition(batch.status as CollectionBatchStatus, "CLOSED");

  const difference = batch.differenceCentavos ?? 0n;
  if (difference !== 0n && !batch.shortageReason) {
    throw new AppError(
      409,
      "INVALID_STATE",
      "Cannot close a non-balanced batch without a recorded shortage/overage reason.",
    );
  }

  await db
    .update(collectionBatches)
    .set({
      status: "CLOSED",
      closedBy: actorUserId,
      closedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(collectionBatches.id, batchId));

  await writeAuditLog(db, {
    actorUserId,
    action: "collection_batch.close",
    entityType: "collection_batch",
    entityId: batchId,
    reason: batch.shortageReason,
    newValues: {
      differenceCentavos: centavosToString(difference),
      balanced: difference === 0n,
    },
  });

  return getCollectionBatch(db, batchId);
}

async function transitionBatch(
  db: Database["db"],
  actorUserId: string,
  batchId: string,
  to: CollectionBatchStatus,
) {
  const [batch] = await db
    .select()
    .from(collectionBatches)
    .where(eq(collectionBatches.id, batchId))
    .limit(1);
  if (!batch) throw new AppError(404, "NOT_FOUND", "Collection batch not found.");
  assertTransition(batch.status as CollectionBatchStatus, to);

  await db
    .update(collectionBatches)
    .set({ status: to, updatedAt: new Date() })
    .where(eq(collectionBatches.id, batchId));

  await writeAuditLog(db, {
    actorUserId,
    action: `collection_batch.${to.toLowerCase()}`,
    entityType: "collection_batch",
    entityId: batchId,
    oldValues: { status: batch.status },
    newValues: { status: to },
  });

  return getCollectionBatch(db, batchId);
}
