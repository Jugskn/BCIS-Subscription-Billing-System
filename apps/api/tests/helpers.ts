import * as argon2 from "argon2";
import { eq } from "drizzle-orm";
import {
  createDb,
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
} from "@bcis/db";
import { loadConfig } from "../src/config.js";
import { buildApp } from "../src/app.js";

export async function createTestApp() {
  const config = loadConfig({
    ...process.env,
    JWT_SECRET: process.env.JWT_SECRET ?? "test-jwt-secret-please-change",
  });
  const app = await buildApp(config);
  await app.ready();
  return { app, config };
}

export async function ensureCashierUser(username = "cashier_test") {
  const config = loadConfig();
  const { db, client } = createDb(config.DATABASE_URL);
  try {
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    let userId = existing[0]?.id;
    if (!userId) {
      const passwordHash = await argon2.hash("CashierPass123!");
      const [row] = await db
        .insert(users)
        .values({
          username,
          passwordHash,
          fullName: "Test Cashier",
          isActive: true,
        })
        .returning();
      if (!row) throw new Error("Failed to create cashier test user");
      userId = row.id;
    } else {
      await db
        .update(users)
        .set({
          passwordHash: await argon2.hash("CashierPass123!"),
          isActive: true,
          failedLoginAttempts: 0,
          lockedUntil: null,
          sessionVersion: 0,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
    }

    const [cashierRole] = await db
      .select()
      .from(roles)
      .where(eq(roles.name, "Cashier"))
      .limit(1);
    if (!cashierRole) throw new Error("Cashier role missing — run db:seed");

    await db.delete(userRoles).where(eq(userRoles.userId, userId));
    await db.insert(userRoles).values({ userId, roleId: cashierRole.id });

    // Sanity: cashier must not have user.manage
    const granted = await db
      .select({ code: permissions.code })
      .from(userRoles)
      .innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(userRoles.userId, userId));
    if (granted.some((g) => g.code === "user.manage")) {
      throw new Error("Cashier unexpectedly has user.manage");
    }

    return { username, password: "CashierPass123!" };
  } finally {
    await client.end({ timeout: 5 });
  }
}
