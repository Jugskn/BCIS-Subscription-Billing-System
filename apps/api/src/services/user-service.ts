import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import {
  roles,
  userRoles,
  users,
  type Database,
} from "@bcis/db";
import type { CreateUserInput } from "@bcis/shared";
import { AppError } from "../lib/errors.js";
import { hashPassword } from "../lib/password.js";
import { writeAuditLog } from "../lib/audit.js";

export async function listUsers(
  db: Database["db"],
  query: { page: number; pageSize: number; search?: string },
) {
  const offset = (query.page - 1) * query.pageSize;
  const filters = query.search
    ? or(
        ilike(users.username, `%${query.search}%`),
        ilike(users.fullName, `%${query.search}%`),
      )
    : undefined;

  const where = filters ? and(filters) : undefined;

  const [totalRow] = await db
    .select({ value: count() })
    .from(users)
    .where(where);

  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      isActive: users.isActive,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt))
    .limit(query.pageSize)
    .offset(offset);

  const ids = rows.map((r) => r.id);
  const roleRows =
    ids.length === 0
      ? []
      : await db
          .select({
            userId: userRoles.userId,
            roleName: roles.name,
          })
          .from(userRoles)
          .innerJoin(roles, eq(userRoles.roleId, roles.id))
          .where(inArray(userRoles.userId, ids));

  const rolesByUser = new Map<string, string[]>();
  for (const row of roleRows) {
    const list = rolesByUser.get(row.userId) ?? [];
    list.push(row.roleName);
    rolesByUser.set(row.userId, list);
  }

  return {
    items: rows.map((r) => ({
      id: r.id,
      username: r.username,
      fullName: r.fullName,
      isActive: r.isActive,
      roles: rolesByUser.get(r.id) ?? [],
      createdAt: r.createdAt.toISOString(),
    })),
    page: query.page,
    pageSize: query.pageSize,
    total: Number(totalRow?.value ?? 0),
  };
}

export async function createUser(
  db: Database["db"],
  actorUserId: string,
  input: CreateUserInput,
) {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, input.username))
    .limit(1);
  if (existing[0]) {
    throw new AppError(409, "USERNAME_TAKEN", "That username is already in use.");
  }

  const roleRows = await db
    .select()
    .from(roles)
    .where(inArray(roles.name, input.roleNames));
  if (roleRows.length !== input.roleNames.length) {
    throw new AppError(400, "INVALID_ROLE", "One or more roles are invalid.");
  }

  const passwordHash = await hashPassword(input.password);

  const created = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        username: input.username,
        passwordHash,
        fullName: input.fullName,
        isActive: true,
      })
      .returning();
    if (!user) throw new AppError(500, "CREATE_FAILED", "Could not create user.");

    await tx.insert(userRoles).values(
      roleRows.map((r) => ({ userId: user.id, roleId: r.id })),
    );

    await writeAuditLog(tx, {
      actorUserId,
      action: "user.create",
      entityType: "user",
      entityId: user.id,
      newValues: {
        username: user.username,
        fullName: user.fullName,
        roles: input.roleNames,
      },
    });

    return user;
  });

  return {
    id: created.id,
    username: created.username,
    fullName: created.fullName,
    isActive: created.isActive,
    roles: input.roleNames,
    createdAt: created.createdAt.toISOString(),
  };
}

export async function deactivateUser(
  db: Database["db"],
  actorUserId: string,
  userId: string,
) {
  if (actorUserId === userId) {
    throw new AppError(400, "SELF_DEACTIVATE", "You cannot deactivate your own account.");
  }

  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (!user) {
    throw new AppError(404, "NOT_FOUND", "User not found.");
  }

  await db
    .update(users)
    .set({
      isActive: false,
      sessionVersion: sql`${users.sessionVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  await writeAuditLog(db, {
    actorUserId,
    action: "user.deactivate",
    entityType: "user",
    entityId: userId,
    oldValues: { isActive: true },
    newValues: { isActive: false },
  });
}

export async function assignUserRoles(
  db: Database["db"],
  actorUserId: string,
  userId: string,
  roleNames: string[],
) {
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!userRows[0]) {
    throw new AppError(404, "NOT_FOUND", "User not found.");
  }

  const roleRows = await db
    .select()
    .from(roles)
    .where(inArray(roles.name, roleNames));
  if (roleRows.length !== roleNames.length) {
    throw new AppError(400, "INVALID_ROLE", "One or more roles are invalid.");
  }

  await db.transaction(async (tx) => {
    await tx.delete(userRoles).where(eq(userRoles.userId, userId));
    await tx.insert(userRoles).values(
      roleRows.map((r) => ({ userId, roleId: r.id })),
    );
    await writeAuditLog(tx, {
      actorUserId,
      action: "user.assign_roles",
      entityType: "user",
      entityId: userId,
      newValues: { roles: roleNames },
    });
  });
}
