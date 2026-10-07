import { and, count, desc, eq, ilike } from "drizzle-orm";
import {
  servicePlans,
  serviceTypes,
  type Database,
} from "@bcis/db";
import type {
  CreateServicePlanInput,
  UpdateServicePlanInput,
} from "@bcis/shared";
import { centavosToString } from "@bcis/shared";
import { AppError } from "../lib/errors.js";
import { writeAuditLog } from "../lib/audit.js";

async function getServiceTypeId(db: Database["db"], code: string) {
  const [row] = await db
    .select()
    .from(serviceTypes)
    .where(eq(serviceTypes.code, code))
    .limit(1);
  if (!row) throw new AppError(400, "INVALID_TYPE", "Invalid service type.");
  return row;
}

function toListItem(
  plan: typeof servicePlans.$inferSelect,
  type: typeof serviceTypes.$inferSelect,
) {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    serviceTypeCode: type.code,
    serviceTypeName: type.name,
    priceCentavos: centavosToString(plan.priceCentavos),
    installationFeeCentavos: centavosToString(plan.installationFeeCentavos),
    speedMbps: plan.speedMbps,
    channelCount: plan.channelCount,
    isActive: plan.isActive,
    createdAt: plan.createdAt.toISOString(),
  };
}

export async function listServicePlans(
  db: Database["db"],
  query: {
    page: number;
    pageSize: number;
    search?: string;
    serviceTypeCode?: string;
    isActive?: boolean;
  },
) {
  const offset = (query.page - 1) * query.pageSize;
  const filters = [];
  if (query.search) {
    filters.push(
      ilike(servicePlans.name, `%${query.search}%`),
    );
  }
  if (query.isActive !== undefined) {
    filters.push(eq(servicePlans.isActive, query.isActive));
  }
  if (query.serviceTypeCode) {
    const type = await getServiceTypeId(db, query.serviceTypeCode);
    filters.push(eq(servicePlans.serviceTypeId, type.id));
  }
  const where = filters.length ? and(...filters) : undefined;

  const [totalRow] = await db
    .select({ value: count() })
    .from(servicePlans)
    .innerJoin(serviceTypes, eq(servicePlans.serviceTypeId, serviceTypes.id))
    .where(where);

  const rows = await db
    .select({ plan: servicePlans, type: serviceTypes })
    .from(servicePlans)
    .innerJoin(serviceTypes, eq(servicePlans.serviceTypeId, serviceTypes.id))
    .where(where)
    .orderBy(desc(servicePlans.createdAt))
    .limit(query.pageSize)
    .offset(offset);

  return {
    items: rows.map((r) => toListItem(r.plan, r.type)),
    page: query.page,
    pageSize: query.pageSize,
    total: Number(totalRow?.value ?? 0),
  };
}

export async function createServicePlan(
  db: Database["db"],
  actorUserId: string,
  input: CreateServicePlanInput,
) {
  const type = await getServiceTypeId(db, input.serviceTypeCode);

  const code = input.code.toUpperCase();
  const existing = await db
    .select({ id: servicePlans.id })
    .from(servicePlans)
    .where(eq(servicePlans.code, code))
    .limit(1);
  if (existing[0]) {
    throw new AppError(409, "CODE_TAKEN", "That plan code is already in use.");
  }

  const [row] = await db
    .insert(servicePlans)
    .values({
      serviceTypeId: type.id,
      code,
      name: input.name,
      description: input.description ?? "",
      priceCentavos: input.price,
      installationFeeCentavos: input.installationFee ?? 0n,
      speedMbps: input.speedMbps ?? null,
      channelCount: input.channelCount ?? null,
      isActive: input.isActive ?? true,
    })
    .returning();

  if (!row) throw new AppError(500, "CREATE_FAILED", "Could not create plan.");

  await writeAuditLog(db, {
    actorUserId,
    action: "service_plan.create",
    entityType: "service_plan",
    entityId: row.id,
    newValues: {
      code: row.code,
      name: row.name,
      priceCentavos: centavosToString(row.priceCentavos),
    },
  });

  return toListItem(row, type);
}

export async function updateServicePlan(
  db: Database["db"],
  actorUserId: string,
  planId: string,
  input: UpdateServicePlanInput,
) {
  const rows = await db
    .select({ plan: servicePlans, type: serviceTypes })
    .from(servicePlans)
    .innerJoin(serviceTypes, eq(servicePlans.serviceTypeId, serviceTypes.id))
    .where(eq(servicePlans.id, planId))
    .limit(1);
  const current = rows[0];
  if (!current) throw new AppError(404, "NOT_FOUND", "Service plan not found.");

  const oldPrice = current.plan.priceCentavos;

  const [updated] = await db
    .update(servicePlans)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.price !== undefined ? { priceCentavos: input.price } : {}),
      ...(input.installationFee !== undefined
        ? { installationFeeCentavos: input.installationFee }
        : {}),
      ...(input.speedMbps !== undefined ? { speedMbps: input.speedMbps } : {}),
      ...(input.channelCount !== undefined
        ? { channelCount: input.channelCount }
        : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      updatedAt: new Date(),
    })
    .where(eq(servicePlans.id, planId))
    .returning();

  if (!updated) throw new AppError(500, "UPDATE_FAILED", "Could not update plan.");

  // Plan price changes affect future billing only — never update service_accounts.current_rate_centavos.
  await writeAuditLog(db, {
    actorUserId,
    action: "service_plan.update",
    entityType: "service_plan",
    entityId: planId,
    oldValues: {
      name: current.plan.name,
      priceCentavos: centavosToString(oldPrice),
      isActive: current.plan.isActive,
    },
    newValues: {
      name: updated.name,
      priceCentavos: centavosToString(updated.priceCentavos),
      isActive: updated.isActive,
    },
  });

  return toListItem(updated, current.type);
}

export async function listServiceTypes(db: Database["db"]) {
  const rows = await db.select().from(serviceTypes).orderBy(serviceTypes.name);
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
  }));
}
