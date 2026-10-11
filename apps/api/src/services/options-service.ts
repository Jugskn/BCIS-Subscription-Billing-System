import { and, asc, eq, ilike, inArray, or } from "drizzle-orm";
import {
  collectionAreas,
  roles,
  servicePlans,
  subscribers,
  userRoles,
  users,
  type Database,
} from "@bcis/db";
import { OPTIONS_LIMIT, centavosToString } from "@bcis/shared";

export async function listSubscriberOptions(
  db: Database["db"],
  search?: string,
) {
  const filters = [
    inArray(subscribers.status, ["ACTIVE", "INACTIVE"]),
  ];
  if (search) {
    filters.push(
      or(
        ilike(subscribers.accountNumber, `%${search}%`),
        ilike(subscribers.fullName, `%${search}%`),
      )!,
    );
  }

  const rows = await db
    .select({
      id: subscribers.id,
      accountNumber: subscribers.accountNumber,
      fullName: subscribers.fullName,
    })
    .from(subscribers)
    .where(and(...filters))
    .orderBy(asc(subscribers.accountNumber))
    .limit(OPTIONS_LIMIT);

  return rows;
}

export async function listPlanOptions(db: Database["db"], search?: string) {
  const filters = [eq(servicePlans.isActive, true)];
  if (search) {
    filters.push(
      or(
        ilike(servicePlans.code, `%${search}%`),
        ilike(servicePlans.name, `%${search}%`),
      )!,
    );
  }

  const rows = await db
    .select({
      id: servicePlans.id,
      code: servicePlans.code,
      name: servicePlans.name,
      priceCentavos: servicePlans.priceCentavos,
    })
    .from(servicePlans)
    .where(and(...filters))
    .orderBy(asc(servicePlans.code))
    .limit(OPTIONS_LIMIT);

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    priceCentavos: centavosToString(r.priceCentavos),
  }));
}

export async function listAreaOptions(db: Database["db"], search?: string) {
  const filters = [eq(collectionAreas.isActive, true)];
  if (search) {
    filters.push(
      or(
        ilike(collectionAreas.code, `%${search}%`),
        ilike(collectionAreas.name, `%${search}%`),
      )!,
    );
  }

  return db
    .select({
      id: collectionAreas.id,
      code: collectionAreas.code,
      name: collectionAreas.name,
    })
    .from(collectionAreas)
    .where(and(...filters))
    .orderBy(asc(collectionAreas.code))
    .limit(OPTIONS_LIMIT);
}

async function listRoleUserOptions(
  db: Database["db"],
  roleName: string,
  search?: string,
) {
  const filters = [eq(users.isActive, true), eq(roles.name, roleName)];
  if (search) {
    filters.push(
      or(
        ilike(users.fullName, `%${search}%`),
        ilike(users.username, `%${search}%`),
      )!,
    );
  }

  return db
    .selectDistinct({
      id: users.id,
      fullName: users.fullName,
      username: users.username,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(...filters))
    .orderBy(asc(users.fullName))
    .limit(OPTIONS_LIMIT);
}

export async function listCollectorOptions(
  db: Database["db"],
  search?: string,
) {
  return listRoleUserOptions(db, "Collector", search);
}

export async function listTechnicianOptions(
  db: Database["db"],
  search?: string,
) {
  return listRoleUserOptions(db, "Technician", search);
}

/** Active users eligible to approve suspensions (Owner / Administrator). */
export async function listApproverOptions(
  db: Database["db"],
  search?: string,
) {
  const filters = [
    eq(users.isActive, true),
    inArray(roles.name, ["Owner", "Administrator"]),
  ];
  if (search) {
    filters.push(
      or(
        ilike(users.fullName, `%${search}%`),
        ilike(users.username, `%${search}%`),
      )!,
    );
  }

  return db
    .selectDistinct({
      id: users.id,
      fullName: users.fullName,
      username: users.username,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(...filters))
    .orderBy(asc(users.fullName))
    .limit(OPTIONS_LIMIT);
}
