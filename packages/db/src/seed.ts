import { config } from "dotenv";
import * as argon2 from "argon2";
import { eq } from "drizzle-orm";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PERMISSIONS,
  ROLE_PERMISSION_MATRIX,
  ROLES,
  type PermissionCode,
  type RoleName,
} from "@bcis/shared";
import { createDb } from "./client.js";
import {
  applicationSettings,
  collectionAreas,
  permissions,
  rolePermissions,
  roles,
  servicePlans,
  serviceTypes,
  userRoles,
  users,
} from "./schema/index.js";
import { pesosToCentavos } from "@bcis/shared";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
config({ path: resolve(root, ".env") });

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is required");
}

const ownerUsername = process.env.SEED_OWNER_USERNAME ?? "owner";
const ownerPasswordRaw = process.env.SEED_OWNER_PASSWORD;
if (!ownerPasswordRaw) {
  throw new Error("SEED_OWNER_PASSWORD is required");
}
const ownerPassword: string = ownerPasswordRaw;

const { db, client } = createDb(url);

const permissionDescriptions: Record<PermissionCode, string> = {
  "subscriber.view": "View subscribers and service accounts",
  "subscriber.create": "Create subscribers",
  "subscriber.update": "Update subscribers",
  "subscriber.deactivate": "Deactivate subscribers",
  "billing.generate": "Generate billing invoices",
  "billing.void": "Void invoices",
  "payment.create": "Record payments",
  "payment.reverse": "Reverse posted payments",
  "payment.allocate_manual": "Manually allocate payments",
  "gcash.verify": "Verify GCash payments",
  "gcash.reject": "Reject GCash payments",
  "collection.create": "Create collection batches",
  "collection.reconcile": "Reconcile collection batches",
  "collection.close": "Close collection batches",
  "receivable.view": "View receivables and aging",
  "service.manage": "Manage service plans and tickets",
  "report.view": "View reports",
  "report.export": "Export reports",
  "user.manage": "Manage users and role assignments",
  "role.manage": "Manage role definitions",
  "settings.manage": "Manage application settings",
  "backup.create": "Create database backups",
  "backup.restore": "Restore database backups",
  "audit.view": "View audit logs",
};

const roleDescriptions: Record<RoleName, string> = {
  Owner: "Full system access including backup restore",
  Administrator: "Subscribers, billing, collections, operational reports",
  Cashier: "Subscriber search, payments, balances, GCash verification",
  "Collection Supervisor": "Areas, batches, remittance, reconciliation",
  Collector: "Field collection assignment; route sheet access",
  Auditor: "Reports, receivables, audit trails (read-only)",
  Technician: "Service account and suspension/reconnection info",
  Viewer: "Dashboards and reports, no mutations",
};

async function upsertPermissions() {
  const byCode = new Map<string, string>();
  for (const code of PERMISSIONS) {
    const existing = await db
      .select()
      .from(permissions)
      .where(eq(permissions.code, code))
      .limit(1);
    if (existing[0]) {
      byCode.set(code, existing[0].id);
      continue;
    }
    const [row] = await db
      .insert(permissions)
      .values({ code, description: permissionDescriptions[code] })
      .returning();
    if (!row) throw new Error(`Failed to insert permission ${code}`);
    byCode.set(code, row.id);
  }
  return byCode;
}

async function upsertRoles() {
  const byName = new Map<string, string>();
  for (const name of ROLES) {
    const existing = await db
      .select()
      .from(roles)
      .where(eq(roles.name, name))
      .limit(1);
    if (existing[0]) {
      byName.set(name, existing[0].id);
      continue;
    }
    const [row] = await db
      .insert(roles)
      .values({ name, description: roleDescriptions[name] })
      .returning();
    if (!row) throw new Error(`Failed to insert role ${name}`);
    byName.set(name, row.id);
  }
  return byName;
}

async function seedMatrix(
  roleIds: Map<string, string>,
  permissionIds: Map<string, string>,
) {
  for (const roleName of ROLES) {
    const roleId = roleIds.get(roleName);
    if (!roleId) throw new Error(`Missing role ${roleName}`);
    const codes = ROLE_PERMISSION_MATRIX[roleName];
    // Replace so matrix removals take effect on re-seed.
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    if (codes.length === 0) continue;
    await db.insert(rolePermissions).values(
      codes.map((code) => {
        const permissionId = permissionIds.get(code);
        if (!permissionId) throw new Error(`Missing permission ${code}`);
        return { roleId, permissionId };
      }),
    );
  }
}

async function seedOwner(roleIds: Map<string, string>) {
  const ownerRoleId = roleIds.get("Owner");
  if (!ownerRoleId) throw new Error("Owner role missing");

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.username, ownerUsername))
    .limit(1);

  let userId = existing[0]?.id;
  if (!userId) {
    const passwordHash = await argon2.hash(ownerPassword);
    const [row] = await db
      .insert(users)
      .values({
        username: ownerUsername,
        passwordHash,
        fullName: "System Owner",
        isActive: true,
      })
      .returning();
    if (!row) throw new Error("Failed to create owner user");
    userId = row.id;
  }

  await db
    .insert(userRoles)
    .values({ userId, roleId: ownerRoleId })
    .onConflictDoNothing();

  return userId;
}

async function seedServiceCatalog() {
  const types = [
    { code: "INTERNET", name: "Internet" },
    { code: "CABLE", name: "Cable" },
    { code: "COMBO", name: "Combo" },
  ];
  const typeIds = new Map<string, string>();
  for (const st of types) {
    const existing = await db
      .select()
      .from(serviceTypes)
      .where(eq(serviceTypes.code, st.code))
      .limit(1);
    if (existing[0]) {
      typeIds.set(st.code, existing[0].id);
      continue;
    }
    const [row] = await db.insert(serviceTypes).values(st).returning();
    if (!row) throw new Error(`Failed to seed service type ${st.code}`);
    typeIds.set(st.code, row.id);
  }

  const plans: Array<{
    code: string;
    name: string;
    type: string;
    price: string;
    speedMbps?: number;
    channelCount?: number;
  }> = [
    { code: "NET-50", name: "Internet 50 Mbps", type: "INTERNET", price: "999", speedMbps: 50 },
    { code: "NET-100", name: "Internet 100 Mbps", type: "INTERNET", price: "1499", speedMbps: 100 },
    { code: "NET-200", name: "Internet 200 Mbps", type: "INTERNET", price: "1999", speedMbps: 200 },
    { code: "CBL-BASIC", name: "Cable Basic", type: "CABLE", price: "599", channelCount: 50 },
    { code: "CBL-PLUS", name: "Cable Plus", type: "CABLE", price: "899", channelCount: 90 },
    { code: "COMBO-1", name: "Combo Starter", type: "COMBO", price: "1299", speedMbps: 50, channelCount: 50 },
    { code: "COMBO-2", name: "Combo Premium", type: "COMBO", price: "1799", speedMbps: 100, channelCount: 90 },
  ];

  for (const p of plans) {
    const typeId = typeIds.get(p.type);
    if (!typeId) continue;
    await db
      .insert(servicePlans)
      .values({
        serviceTypeId: typeId,
        code: p.code,
        name: p.name,
        priceCentavos: pesosToCentavos(p.price),
        speedMbps: p.speedMbps ?? null,
        channelCount: p.channelCount ?? null,
        isActive: true,
      })
      .onConflictDoNothing({ target: servicePlans.code });
  }

  const areas = [
    { code: "MAL-N", name: "Malaybalay North", description: "Northern barangays" },
    { code: "MAL-S", name: "Malaybalay South", description: "Southern barangays" },
    { code: "VAL-C", name: "Valencia Central", description: "Valencia town proper" },
  ];
  for (const a of areas) {
    await db.insert(collectionAreas).values(a).onConflictDoNothing({
      target: collectionAreas.code,
    });
  }
}

async function seedSettings(ownerId: string) {
  const defaults: Array<{ key: string; value: unknown }> = [
    { key: "grace_days", value: 5 },
    { key: "penalties_enabled", value: false },
    { key: "company_name", value: "BCIS Lab" },
    { key: "login_max_attempts", value: 5 },
    { key: "login_lockout_minutes", value: 15 },
  ];

  for (const setting of defaults) {
    await db
      .insert(applicationSettings)
      .values({
        key: setting.key,
        value: setting.value,
        updatedBy: ownerId,
      })
      .onConflictDoNothing();
  }
}

try {
  const permissionIds = await upsertPermissions();
  const roleIds = await upsertRoles();
  await seedMatrix(roleIds, permissionIds);
  const ownerId = await seedOwner(roleIds);
  await seedServiceCatalog();
  await seedSettings(ownerId);
  console.log(`Seed complete. Owner username: ${ownerUsername}`);
} finally {
  await client.end();
}
