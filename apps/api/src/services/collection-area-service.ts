import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import { collectionAreas, subscribers, type Database } from "@bcis/db";
import type {
  CreateCollectionAreaInput,
  UpdateCollectionAreaInput,
} from "@bcis/shared";
import { AppError } from "../lib/errors.js";
import { writeAuditLog } from "../lib/audit.js";

function toListItem(row: typeof collectionAreas.$inferSelect) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listCollectionAreas(
  db: Database["db"],
  query: { page: number; pageSize: number; search?: string; isActive?: boolean },
) {
  const offset = (query.page - 1) * query.pageSize;
  const filters = [];
  if (query.search) {
    filters.push(
      or(
        ilike(collectionAreas.code, `%${query.search}%`),
        ilike(collectionAreas.name, `%${query.search}%`),
      ),
    );
  }
  if (query.isActive !== undefined) {
    filters.push(eq(collectionAreas.isActive, query.isActive));
  }
  const where = filters.length ? and(...filters) : undefined;

  const [totalRow] = await db
    .select({ value: count() })
    .from(collectionAreas)
    .where(where);

  const rows = await db
    .select()
    .from(collectionAreas)
    .where(where)
    .orderBy(desc(collectionAreas.createdAt))
    .limit(query.pageSize)
    .offset(offset);

  return {
    items: rows.map(toListItem),
    page: query.page,
    pageSize: query.pageSize,
    total: Number(totalRow?.value ?? 0),
  };
}

export async function createCollectionArea(
  db: Database["db"],
  actorUserId: string,
  input: CreateCollectionAreaInput,
) {
  const existing = await db
    .select({ id: collectionAreas.id })
    .from(collectionAreas)
    .where(eq(collectionAreas.code, input.code))
    .limit(1);
  if (existing[0]) {
    throw new AppError(409, "CODE_TAKEN", "That area code is already in use.");
  }

  const [row] = await db
    .insert(collectionAreas)
    .values({
      code: input.code.toUpperCase(),
      name: input.name,
      description: input.description ?? "",
      isActive: input.isActive ?? true,
    })
    .returning();

  if (!row) throw new AppError(500, "CREATE_FAILED", "Could not create area.");

  await writeAuditLog(db, {
    actorUserId,
    action: "collection_area.create",
    entityType: "collection_area",
    entityId: row.id,
    newValues: { code: row.code, name: row.name },
  });

  return toListItem(row);
}

export async function updateCollectionArea(
  db: Database["db"],
  actorUserId: string,
  areaId: string,
  input: UpdateCollectionAreaInput,
) {
  const rows = await db
    .select()
    .from(collectionAreas)
    .where(eq(collectionAreas.id, areaId))
    .limit(1);
  const area = rows[0];
  if (!area) throw new AppError(404, "NOT_FOUND", "Collection area not found.");

  if (input.code && input.code !== area.code) {
    const dup = await db
      .select({ id: collectionAreas.id })
      .from(collectionAreas)
      .where(eq(collectionAreas.code, input.code))
      .limit(1);
    if (dup[0]) {
      throw new AppError(409, "CODE_TAKEN", "That area code is already in use.");
    }
  }

  const [updated] = await db
    .update(collectionAreas)
    .set({
      ...(input.code !== undefined ? { code: input.code.toUpperCase() } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined
        ? { description: input.description ?? "" }
        : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      updatedAt: new Date(),
    })
    .where(eq(collectionAreas.id, areaId))
    .returning();

  if (!updated) throw new AppError(500, "UPDATE_FAILED", "Could not update area.");

  await writeAuditLog(db, {
    actorUserId,
    action: "collection_area.update",
    entityType: "collection_area",
    entityId: areaId,
    oldValues: { code: area.code, name: area.name, isActive: area.isActive },
    newValues: {
      code: updated.code,
      name: updated.name,
      isActive: updated.isActive,
    },
  });

  return toListItem(updated);
}

export async function deleteCollectionArea(
  db: Database["db"],
  actorUserId: string,
  areaId: string,
) {
  const rows = await db
    .select()
    .from(collectionAreas)
    .where(eq(collectionAreas.id, areaId))
    .limit(1);
  const area = rows[0];
  if (!area) throw new AppError(404, "NOT_FOUND", "Collection area not found.");

  const [usage] = await db
    .select({ value: count() })
    .from(subscribers)
    .where(eq(subscribers.collectionAreaId, areaId));
  if (Number(usage?.value ?? 0) > 0) {
    throw new AppError(
      409,
      "AREA_IN_USE",
      "Cannot delete an area that still has subscribers assigned.",
    );
  }

  await db.delete(collectionAreas).where(eq(collectionAreas.id, areaId));

  await writeAuditLog(db, {
    actorUserId,
    action: "collection_area.delete",
    entityType: "collection_area",
    entityId: areaId,
    oldValues: { code: area.code, name: area.name },
  });
}
