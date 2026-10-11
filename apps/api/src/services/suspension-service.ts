import { desc, eq } from "drizzle-orm";
import {
  reconnectionRecords,
  serviceAccounts,
  suspensionRecords,
  users,
  type Database,
} from "@bcis/db";
import {
  centavosToString,
  type CreateReconnectionInput,
  type CreateSuspensionInput,
} from "@bcis/shared";
import { AppError } from "../lib/errors.js";
import { writeAuditLog } from "../lib/audit.js";
import { recordServiceEvent } from "../lib/service-events.js";

export async function createSuspension(
  db: Database["db"],
  actorUserId: string,
  input: CreateSuspensionInput,
) {
  const [account] = await db
    .select()
    .from(serviceAccounts)
    .where(eq(serviceAccounts.id, input.serviceAccountId))
    .limit(1);
  if (!account) {
    throw new AppError(404, "NOT_FOUND", "Service account not found.");
  }
  if (account.status === "SUSPENDED") {
    throw new AppError(409, "ALREADY_SUSPENDED", "Service account is already suspended.");
  }
  if (account.status !== "ACTIVE") {
    throw new AppError(
      409,
      "INVALID_STATE",
      "Only active service accounts can be suspended.",
    );
  }

  const approvedBy = input.approvedBy ?? actorUserId;
  if (input.approvedBy) {
    const [approver] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.approvedBy))
      .limit(1);
    if (!approver) {
      throw new AppError(400, "INVALID_APPROVER", "Approver user not found.");
    }
  }

  return db.transaction(async (tx) => {
    const [suspension] = await tx
      .insert(suspensionRecords)
      .values({
        serviceAccountId: input.serviceAccountId,
        reason: input.reason,
        effectiveDate: input.effectiveDate,
        approvedBy,
        notes: input.notes ?? null,
      })
      .returning();
    if (!suspension) {
      throw new AppError(500, "CREATE_FAILED", "Could not create suspension record.");
    }

    await tx
      .update(serviceAccounts)
      .set({ status: "SUSPENDED", updatedAt: new Date() })
      .where(eq(serviceAccounts.id, input.serviceAccountId));

    await recordServiceEvent(tx, {
      serviceAccountId: input.serviceAccountId,
      eventType: "SUSPENSION",
      oldStatus: account.status,
      newStatus: "SUSPENDED",
      reason: input.reason,
      actorUserId,
    });

    await writeAuditLog(tx, {
      actorUserId,
      action: "suspension.create",
      entityType: "suspension_record",
      entityId: suspension.id,
      reason: input.reason,
      newValues: {
        serviceAccountId: input.serviceAccountId,
        effectiveDate: input.effectiveDate,
        approvedBy,
      },
    });

    return {
      id: suspension.id,
      serviceAccountId: suspension.serviceAccountId,
      reason: suspension.reason,
      effectiveDate: suspension.effectiveDate,
      approvedBy: suspension.approvedBy,
      notes: suspension.notes,
      createdAt: suspension.createdAt.toISOString(),
    };
  });
}

export async function createReconnection(
  db: Database["db"],
  actorUserId: string,
  input: CreateReconnectionInput,
) {
  const [account] = await db
    .select()
    .from(serviceAccounts)
    .where(eq(serviceAccounts.id, input.serviceAccountId))
    .limit(1);
  if (!account) {
    throw new AppError(404, "NOT_FOUND", "Service account not found.");
  }
  if (account.status !== "SUSPENDED") {
    throw new AppError(
      409,
      "INVALID_STATE",
      "Reconnection can only start for suspended service accounts.",
    );
  }

  if (input.technicianUserId) {
    const [tech] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.technicianUserId))
      .limit(1);
    if (!tech) {
      throw new AppError(400, "INVALID_TECHNICIAN", "Technician user not found.");
    }
  }

  const requestedAt = input.requestDate
    ? new Date(`${input.requestDate}T00:00:00.000Z`)
    : new Date();

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(reconnectionRecords)
      .values({
        serviceAccountId: input.serviceAccountId,
        suspensionId: input.suspensionId ?? null,
        feeCentavos: BigInt(input.feeCentavos ?? "0"),
        technicianUserId: input.technicianUserId ?? null,
        status: "PENDING",
        requestedAt,
        notes: input.notes ?? null,
      })
      .returning();
    if (!row) {
      throw new AppError(500, "CREATE_FAILED", "Could not create reconnection record.");
    }

    await recordServiceEvent(tx, {
      serviceAccountId: input.serviceAccountId,
      eventType: "RECONNECTION_REQUESTED",
      oldStatus: account.status,
      newStatus: account.status,
      reason: input.notes ?? "Reconnection requested",
      actorUserId,
    });

    await writeAuditLog(tx, {
      actorUserId,
      action: "reconnection.create",
      entityType: "reconnection_record",
      entityId: row.id,
      newValues: {
        serviceAccountId: input.serviceAccountId,
        feeCentavos: centavosToString(row.feeCentavos),
        status: "PENDING",
        requestedAt: row.requestedAt.toISOString(),
      },
    });

    return {
      id: row.id,
      serviceAccountId: row.serviceAccountId,
      suspensionId: row.suspensionId,
      feeCentavos: centavosToString(row.feeCentavos),
      technicianUserId: row.technicianUserId,
      status: row.status,
      requestedAt: row.requestedAt.toISOString(),
      completedAt: null,
      notes: row.notes,
    };
  });
}

export async function completeReconnection(
  db: Database["db"],
  actorUserId: string,
  reconnectionId: string,
  notes?: string | null,
) {
  const [row] = await db
    .select()
    .from(reconnectionRecords)
    .where(eq(reconnectionRecords.id, reconnectionId))
    .limit(1);
  if (!row) throw new AppError(404, "NOT_FOUND", "Reconnection record not found.");
  if (row.status !== "PENDING") {
    throw new AppError(409, "INVALID_STATE", "Reconnection is not pending.");
  }

  const [account] = await db
    .select()
    .from(serviceAccounts)
    .where(eq(serviceAccounts.id, row.serviceAccountId))
    .limit(1);
  if (!account) {
    throw new AppError(404, "NOT_FOUND", "Service account not found.");
  }

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(reconnectionRecords)
      .set({
        status: "COMPLETED",
        completedAt: new Date(),
        notes: notes ?? row.notes,
      })
      .where(eq(reconnectionRecords.id, reconnectionId))
      .returning();

    await tx
      .update(serviceAccounts)
      .set({ status: "ACTIVE", updatedAt: new Date() })
      .where(eq(serviceAccounts.id, row.serviceAccountId));

    await recordServiceEvent(tx, {
      serviceAccountId: row.serviceAccountId,
      eventType: "RECONNECTION",
      oldStatus: account.status,
      newStatus: "ACTIVE",
      reason: notes ?? "Reconnection completed",
      actorUserId,
    });

    await writeAuditLog(tx, {
      actorUserId,
      action: "reconnection.complete",
      entityType: "reconnection_record",
      entityId: reconnectionId,
      reason: notes ?? null,
      oldValues: { status: "PENDING" },
      newValues: { status: "COMPLETED" },
    });

    return {
      id: updated!.id,
      serviceAccountId: updated!.serviceAccountId,
      status: updated!.status,
      completedAt: updated!.completedAt!.toISOString(),
      notes: updated!.notes,
    };
  });
}

export async function listSuspensionsForAccount(
  db: Database["db"],
  serviceAccountId: string,
) {
  const rows = await db
    .select()
    .from(suspensionRecords)
    .where(eq(suspensionRecords.serviceAccountId, serviceAccountId))
    .orderBy(desc(suspensionRecords.createdAt));
  return rows.map((r) => ({
    id: r.id,
    serviceAccountId: r.serviceAccountId,
    reason: r.reason,
    effectiveDate: r.effectiveDate,
    approvedBy: r.approvedBy,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
  }));
}
