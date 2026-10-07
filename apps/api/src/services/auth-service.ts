import { eq, inArray } from "drizzle-orm";
import {
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
  type Database,
} from "@bcis/db";
import { AppError } from "../lib/errors.js";
import { verifyPassword } from "../lib/password.js";
import { writeAuditLog } from "../lib/audit.js";

export type AuthContext = {
  roles: string[];
  permissions: string[];
};

export async function getUserAuthContext(
  db: Database["db"],
  userId: string,
): Promise<AuthContext> {
  const assigned = await db
    .select({ roleId: userRoles.roleId, roleName: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));

  const roleNames = assigned.map((r) => r.roleName);
  const roleIds = assigned.map((r) => r.roleId);
  if (roleIds.length === 0) {
    return { roles: roleNames, permissions: [] };
  }

  const granted = await db
    .select({ code: permissions.code })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(inArray(rolePermissions.roleId, roleIds));

  const unique = [...new Set(granted.map((g) => g.code))];
  return { roles: roleNames, permissions: unique };
}

export async function loginUser(
  db: Database["db"],
  input: {
    username: string;
    password: string;
    maxAttempts: number;
    lockoutMinutes: number;
  },
) {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.username, input.username))
    .limit(1);
  const user = rows[0];

  if (!user || !user.isActive) {
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid username or password.");
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(
      423,
      "ACCOUNT_LOCKED",
      "This account is temporarily locked due to failed sign-in attempts.",
    );
  }

  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok) {
    const attempts = user.failedLoginAttempts + 1;
    const locked =
      attempts >= input.maxAttempts
        ? new Date(Date.now() + input.lockoutMinutes * 60_000)
        : null;

    await db
      .update(users)
      .set({
        failedLoginAttempts: locked ? 0 : attempts,
        lockedUntil: locked,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    await writeAuditLog(db, {
      actorUserId: user.id,
      action: "auth.login_failed",
      entityType: "user",
      entityId: user.id,
      newValues: { attempts, locked: Boolean(locked) },
    });

    if (locked) {
      throw new AppError(
        423,
        "ACCOUNT_LOCKED",
        "This account is temporarily locked due to failed sign-in attempts.",
      );
    }

    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid username or password.");
  }

  await db
    .update(users)
    .set({
      failedLoginAttempts: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  const ctx = await getUserAuthContext(db, user.id);

  await writeAuditLog(db, {
    actorUserId: user.id,
    action: "auth.login",
    entityType: "user",
    entityId: user.id,
  });

  return {
    user: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      roles: ctx.roles,
      permissions: ctx.permissions,
      sessionVersion: user.sessionVersion,
    },
  };
}

export async function logoutUser(db: Database["db"], userId: string) {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (!user) return;

  await db
    .update(users)
    .set({
      sessionVersion: user.sessionVersion + 1,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  await writeAuditLog(db, {
    actorUserId: user.id,
    action: "auth.logout",
    entityType: "user",
    entityId: user.id,
  });
}
