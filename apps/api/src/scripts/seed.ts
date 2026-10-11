/**
 * Idempotent lab dataset (SPEC §8). Truncates domain tables, reseeds reference
 * data and realistic fictional subscribers via domain services.
 *
 * Lab logins (never for production):
 *   owner / (SEED_OWNER_PASSWORD from .env)
 *   admin / AdminPass123!
 *   cashier / CashierPass123!
 *   supervisor / SupervisorPass123!
 *   collector1 / CollectorPass123!
 *   collector2 / CollectorPass123!
 */
import { config } from "dotenv";
import * as argon2 from "argon2";
import { sql } from "drizzle-orm";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PERMISSIONS,
  ROLE_PERMISSION_MATRIX,
  ROLES,
  SETTING_DEFAULTS,
  SETTING_KEYS,
  pesosToCentavos,
  type PermissionCode,
  type RoleName,
} from "@bcis/shared";
import {
  accountSequences,
  applicationSettings,
  collectionAreas,
  collectorAssignments,
  createDb,
  permissions,
  rolePermissions,
  roles,
  servicePlans,
  serviceTypes,
  userRoles,
  users,
} from "@bcis/db";
import { createSubscriber } from "../services/subscriber-service.js";
import { createServiceAccount } from "../services/service-account-service.js";
import { generateBillingForPeriod } from "../services/billing-service.js";
import {
  postPayment,
  recordGCashPending,
  rejectGCashPayment,
  reversePayment,
  verifyGCashPayment,
} from "../services/payment-service.js";
import {
  closeCollectionBatch,
  createCollectionBatch,
  recordBatchCollection,
  reconcileCollectionBatch,
  remitCollectionBatch,
  startCollectionBatch,
  submitCollectionBatch,
} from "../services/collection-batch-service.js";
import {
  completeReconnection,
  createReconnection,
  createSuspension,
} from "../services/suspension-service.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
config({ path: resolve(root, ".env") });

const DOMAIN_TABLES = [
  "backup_history",
  "reconnection_records",
  "suspension_records",
  "collection_batch_accounts",
  "collection_batches",
  "collector_assignments",
  "payment_allocations",
  "payment_proofs",
  "payment_reversals",
  "receipts",
  "payments",
  "invoice_items",
  "adjustments",
  "ledger_entries",
  "invoices",
  "billing_cycles",
  "subscriber_credits",
  "service_events",
  "service_accounts",
  "subscribers",
  "audit_logs",
  "user_roles",
  "users",
  "role_permissions",
  "roles",
  "permissions",
  "service_plans",
  "service_types",
  "collection_areas",
  "application_settings",
  "account_sequences",
] as const;

const BILLING_PERIODS = ["2026-05", "2026-07", "2026-09"] as const;

const PASSWORDS = {
  admin: "AdminPass123!",
  cashier: "CashierPass123!",
  supervisor: "SupervisorPass123!",
  collector: "CollectorPass123!",
} as const;

const FIRST_NAMES = [
  "Ana Kristel", "Benigno", "Carmela Joy", "Dante Rafael", "Estrella Mae",
  "Ferdinand", "Gloria Faith", "Harold James", "Irene Claire", "Jasper Neil",
  "Karen Louise", "Lorenzo", "Melissa Ann", "Norberto", "Olivia Grace",
  "Pedro Miguel", "Queenie Mae", "Ricardo", "Sofia Elaine", "Teodoro",
  "Ursula Joy", "Vladimir", "Wendy Anne", "Xavier Paul", "Yolanda Mae",
  "Zachary", "Amelia Rose", "Bernard", "Cecile Ann", "Dominic",
  "Erica Mae", "Felix Aaron", "Gemma Claire", "Hugo Martin", "Isabel Grace",
  "Jonathan", "Kyla Marie", "Lito", "Monica Faith", "Nestor",
  "Odette Anne", "Paulo Cesar", "Quincy", "Ramonita", "Stefan",
  "Teresa Joy", "Ulysses", "Vanessa Mae", "Warren", "Zenaida",
] as const;

const MIDDLE_NAMES = [
  "Amparo", "Bustamante", "Cortes", "Delos Santos", "Espiritu", "Fortich",
  "Gomez", "Halasan", "Ibarra", "Javier", "Kintanar", "Labrador", "Miranda",
  "Neri", "Orcullo", "Perez", "Quinones", "Roxas", "Salcedo", "Taborada",
] as const;

const SURNAMES = [
  "Alvarez", "Bacolod", "Cagayan", "Dumaual", "Estrella", "Fabelico",
  "Gumabon", "Hinampas", "Inigo", "Jubay", "Kilaton", "Lumapas",
  "Macas", "Nacorda", "Opena", "Pahang", "Quimpo", "Rabanes",
  "Sumaylo", "Taduran", "Ubaldo", "Valmorida", "Wabe", "Yacapin",
  "Zamora", "Abanil", "Balansag", "Caballero", "Daguman", "Echavez",
  "Floresca", "Gallardo", "Hilario", "Inting", "Jarabelo", "Kampilan",
  "Lagdameo", "Magbanua", "Nabua", "Ongkiko", "Parilla", "Quijano",
  "Roa", "Salugsugan", "Tabaco", "Udtohan", "Verdeflor", "Wagas",
  "Ypil", "Zafra",
] as const;

const AREAS = [
  { code: "MAL-CAS", name: "Barangay Casisang", description: "Malaybalay City" },
  { code: "MAL-SUM", name: "Barangay Sumpong", description: "Malaybalay City" },
  { code: "VAL-POB", name: "Barangay Poblacion", description: "Valencia City" },
] as const;

const STREETS = [
  "Purok 1, Sayre Highway", "Purok 2, Capistrano Street", "Purok 3, Fortich Street",
  "Purok 4, Don Carlos Avenue", "Purok 5, San Isidro Road", "Purok 6, Kalayaan Street",
] as const;

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
  "settings.view": "View application settings",
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

function assertLabEnv() {
  const appEnv = (process.env.APP_ENV ?? "").toLowerCase();
  if (appEnv !== "development" && appEnv !== "test") {
    console.error(
      `Refusing to seed: APP_ENV must be development or test (got ${process.env.APP_ENV ?? "(unset)"}).`,
    );
    process.exit(1);
  }
}

function databaseName(url: string) {
  try {
    return new URL(url).pathname.replace(/^\//, "") || "(unknown)";
  } catch {
    return "(unknown)";
  }
}

async function main() {
  assertLabEnv();

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  const ownerUsername = process.env.SEED_OWNER_USERNAME ?? "owner";
  const ownerPassword = process.env.SEED_OWNER_PASSWORD;
  if (!ownerPassword) throw new Error("SEED_OWNER_PASSWORD is required");

  if (new Set(FIRST_NAMES).size < 40 || new Set(SURNAMES).size < 40) {
    throw new Error("Name lists require at least 40 distinct first names and surnames.");
  }
  const generatedNames = FIRST_NAMES.map(
    (first, index) =>
      `${first} ${MIDDLE_NAMES[index % MIDDLE_NAMES.length]} ${SURNAMES[index]}`,
  );
  if (new Set(generatedNames).size !== generatedNames.length) {
    throw new Error("Subscriber full names must be unique.");
  }

  console.log(`Target database: ${databaseName(url)}`);
  console.log(`APP_ENV: ${process.env.APP_ENV}`);

  const { db, client } = createDb(url);
  try {
    console.log("Truncating domain tables and reseeding reference data…");

    const ownerPasswordHash = await argon2.hash(ownerPassword);
    const adminPasswordHash = await argon2.hash(PASSWORDS.admin);
    const cashierPasswordHash = await argon2.hash(PASSWORDS.cashier);
    const supervisorPasswordHash = await argon2.hash(PASSWORDS.supervisor);
    const auditorPasswordHash = await argon2.hash("AuditorPass123!");
    const collectorPasswordHash = await argon2.hash(PASSWORDS.collector);

    const ref = await db.transaction(async (tx) => {
      await tx.execute(sql`
        DO $$ BEGIN
          ALTER TABLE IF EXISTS audit_logs DISABLE TRIGGER ALL;
          ALTER TABLE IF EXISTS backup_history DISABLE TRIGGER ALL;
        END $$;
      `);
      await tx.execute(
        sql.raw(
          `TRUNCATE TABLE ${DOMAIN_TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`,
        ),
      );
      await tx.execute(sql`
        DO $$ BEGIN
          ALTER TABLE IF EXISTS audit_logs ENABLE TRIGGER ALL;
          ALTER TABLE IF EXISTS backup_history ENABLE TRIGGER ALL;
        END $$;
      `);

      const permissionIds = new Map<string, string>();
      for (const code of PERMISSIONS) {
        const [row] = await tx
          .insert(permissions)
          .values({ code, description: permissionDescriptions[code] })
          .returning();
        if (!row) throw new Error(`Failed to insert permission ${code}`);
        permissionIds.set(code, row.id);
      }

      const roleIds = new Map<string, string>();
      for (const name of ROLES) {
        const [row] = await tx
          .insert(roles)
          .values({ name, description: roleDescriptions[name] })
          .returning();
        if (!row) throw new Error(`Failed to insert role ${name}`);
        roleIds.set(name, row.id);
      }

      for (const roleName of ROLES) {
        const roleId = roleIds.get(roleName)!;
        const codes = ROLE_PERMISSION_MATRIX[roleName];
        if (codes.length === 0) continue;
        await tx.insert(rolePermissions).values(
          codes.map((code) => {
            const permissionId = permissionIds.get(code);
            if (!permissionId) throw new Error(`Missing permission ${code}`);
            return { roleId, permissionId };
          }),
        );
      }

      async function insertUser(
        username: string,
        fullName: string,
        passwordHash: string,
        role: string,
      ) {
        const [row] = await tx
          .insert(users)
          .values({ username, passwordHash, fullName, isActive: true })
          .returning();
        if (!row) throw new Error(`Failed to create ${username}`);
        const roleId = roleIds.get(role);
        if (!roleId) throw new Error(`Missing role ${role}`);
        await tx.insert(userRoles).values({ userId: row.id, roleId });
        return row.id;
      }

      const ownerId = await insertUser(
        ownerUsername,
        "Rosario Elena Magbanua",
        ownerPasswordHash,
        "Owner",
      );
      const adminId = await insertUser(
        "admin",
        "Hector David Alonto",
        adminPasswordHash,
        "Administrator",
      );
      await insertUser("cashier", "Patricia Mae Solon", cashierPasswordHash, "Cashier");
      await insertUser(
        "supervisor",
        "Wilfredo Santos Agustin",
        supervisorPasswordHash,
        "Collection Supervisor",
      );
      await insertUser(
        "auditor",
        "Imelda Joy Cagata",
        auditorPasswordHash,
        "Auditor",
      );
      const collector1Id = await insertUser(
        "collector1",
        "Benjie Omar Lambo",
        collectorPasswordHash,
        "Collector",
      );
      const collector2Id = await insertUser(
        "collector2",
        "Clarita Mae Pangan",
        collectorPasswordHash,
        "Collector",
      );

      for (const key of SETTING_KEYS) {
        await tx.insert(applicationSettings).values({
          key,
          value: SETTING_DEFAULTS[key],
          updatedBy: ownerId,
        });
      }

      const typeIds = new Map<string, string>();
      for (const st of [
        { code: "INTERNET", name: "Internet" },
        { code: "CABLE", name: "Cable" },
        { code: "COMBO", name: "Combo" },
      ]) {
        const [row] = await tx.insert(serviceTypes).values(st).returning();
        if (!row) throw new Error(`Failed to seed service type ${st.code}`);
        typeIds.set(st.code, row.id);
      }

      const planDefs: Array<{
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

      for (const p of planDefs) {
        await tx.insert(servicePlans).values({
          serviceTypeId: typeIds.get(p.type)!,
          code: p.code,
          name: p.name,
          priceCentavos: pesosToCentavos(p.price),
          speedMbps: p.speedMbps ?? null,
          channelCount: p.channelCount ?? null,
          isActive: true,
        });
      }

      for (const area of AREAS) {
        await tx.insert(collectionAreas).values(area);
      }

      // Invoice/receipt (and account) counters reset with TRUNCATE RESTART IDENTITY;
      // re-insert locked counter rows at zero.
      await tx.insert(accountSequences).values([
        { prefix: "SUB", lastNumber: 0 },
        { prefix: "SVC", lastNumber: 0 },
        { prefix: "INV", lastNumber: 0 },
        { prefix: "RCPT", lastNumber: 0 },
      ]);

      const areaRows = await tx.select().from(collectionAreas).orderBy(collectionAreas.code);
      await tx.insert(collectorAssignments).values([
        {
          collectorUserId: collector1Id,
          collectionAreaId: areaRows[0]!.id,
          isActive: true,
        },
        {
          collectorUserId: collector2Id,
          collectionAreaId: areaRows[1]!.id,
          isActive: true,
        },
      ]);

      const planRows = await tx.select().from(servicePlans);
      return {
        ownerId,
        adminId,
        collector1Id,
        collector2Id,
        areas: areaRows,
        plans: planRows,
      };
    });

    const { ownerId, adminId, collector1Id, collector2Id, areas, plans } = ref;
    const byCode = new Map(plans.map((p) => [p.code, p]));
    const planList = [
      byCode.get("NET-50")!,
      byCode.get("NET-100")!,
      byCode.get("NET-200")!,
      byCode.get("CBL-BASIC")!,
      byCode.get("CBL-PLUS")!,
      byCode.get("COMBO-1")!,
      byCode.get("COMBO-2")!,
    ];
    if (planList.some((p) => !p)) {
      throw new Error("Expected 7 service plans.");
    }

    console.log("Creating 50 subscribers + service accounts…");
    const subscriberIds: string[] = [];
    const serviceAccountIds: string[] = [];
    let saCount = 0;
    const actorId = ownerId;

    for (let i = 1; i <= 50; i++) {
      const area = areas[(i - 1) % areas.length]!;
      const collectorId = i % 2 === 0 ? collector2Id : collector1Id;
      const firstName = FIRST_NAMES[i - 1]!;
      const surname = SURNAMES[i - 1]!;
      const fullName = `${firstName} ${MIDDLE_NAMES[(i - 1) % MIDDLE_NAMES.length]} ${surname}`;
      const locality = area.description ?? "Bukidnon";
      const address = `${STREETS[(i - 1) % STREETS.length]}, ${area.name}, ${locality}, Bukidnon`;
      const emailLocal = `${firstName.toLowerCase().replaceAll(" ", ".")}.${surname.toLowerCase().replaceAll(" ", "")}`;
      const sub = await createSubscriber(db, actorId, {
        fullName,
        contactPhone: `+63917${String(1_000_000 + i)}`,
        contactEmail: `${emailLocal}@bukidnon.mail`,
        address,
        collectionAreaId: area.id,
        collectorUserId: collectorId,
        dueDay: 5 + (i % 20),
        notes:
          i <= 12
            ? "Fictional demo — overdue cohort"
            : "Fictional demo — active residential account",
      });
      subscriberIds.push(sub.id);

      const accountsForSub = i <= 10 ? 2 : 1;
      for (let a = 0; a < accountsForSub; a++) {
        const plan = planList[(saCount + a) % planList.length]!;
        const sa = await createServiceAccount(db, actorId, {
          subscriberId: sub.id,
          servicePlanId: plan.id,
          installationAddress: `${address}${a > 0 ? `, Unit ${a + 1}` : ""}`,
          activationDate: "2026-01-01",
          billingStartDate: "2026-01-01",
          dueDay: 5 + (i % 20),
          collectorUserId: collectorId,
        });
        serviceAccountIds.push(sa.id);
        saCount += 1;
      }
    }

    console.log(`Service accounts created: ${serviceAccountIds.length}`);
    console.log("Generating 3 billing months…");
    for (const period of BILLING_PERIODS) {
      const result = await generateBillingForPeriod(db, actorId, period);
      console.log(
        `  ${period}: created=${result.createdCount} skipped=${result.skippedCount}`,
      );
    }

    console.log("Posting mixed payments…");
    for (let i = 21; i <= 30; i++) {
      await postPayment(db, actorId, {
        subscriberId: subscriberIds[i - 1]!,
        amountCentavos: 99900n,
        method: "Cash",
        receivedAt: new Date("2026-09-20T10:00:00Z"),
        idempotencyKey: `pay-exact-${i}`,
        allowManual: false,
        notes: "Exact cash payment",
      });
    }

    for (let i = 31; i <= 35; i++) {
      await postPayment(db, actorId, {
        subscriberId: subscriberIds[i - 1]!,
        amountCentavos: 50000n,
        method: "Cash",
        receivedAt: new Date("2026-09-21T10:00:00Z"),
        idempotencyKey: `pay-partial-${i}`,
        allowManual: false,
        notes: "Partial cash payment",
      });
    }

    for (let i = 36; i <= 38; i++) {
      await postPayment(db, actorId, {
        subscriberId: subscriberIds[i - 1]!,
        amountCentavos: 300000n,
        method: "Cash",
        receivedAt: new Date("2026-09-22T10:00:00Z"),
        idempotencyKey: `pay-advance-${i}`,
        allowManual: false,
        notes: "Advance cash payment",
      });
    }

    const uploadDir = resolve(root, "apps/api/uploads");
    await mkdir(uploadDir, { recursive: true });
    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );

    async function writeProof(name: string) {
      const path = resolve(uploadDir, name);
      await writeFile(path, tinyPng);
      return {
        originalFilename: name,
        storedFilename: name,
        storagePath: path,
        mimeType: "image/png",
        sizeBytes: tinyPng.length,
      };
    }

    await recordGCashPending(db, actorId, {
      subscriberId: subscriberIds[39]!,
      amountCentavos: 99900n,
      referenceNumber: "GCASH-PEND-001",
      senderName: `${FIRST_NAMES[39]} ${SURNAMES[39]}`,
      idempotencyKey: "pay-gcash-pend",
      proof: await writeProof("gcash-pending.png"),
      notes: "GCash awaiting verification",
    });

    const verified = await recordGCashPending(db, actorId, {
      subscriberId: subscriberIds[40]!,
      amountCentavos: 99900n,
      referenceNumber: "GCASH-OK-001",
      senderName: `${FIRST_NAMES[40]} ${SURNAMES[40]}`,
      idempotencyKey: "pay-gcash-ok",
      proof: await writeProof("gcash-verified.png"),
    });
    await verifyGCashPayment(db, actorId, verified.payment.id, false);

    const rejected = await recordGCashPending(db, actorId, {
      subscriberId: subscriberIds[41]!,
      amountCentavos: 59900n,
      referenceNumber: "GCASH-NO-001",
      senderName: `${FIRST_NAMES[41]} ${SURNAMES[41]}`,
      idempotencyKey: "pay-gcash-no",
      proof: await writeProof("gcash-rejected.png"),
    });
    await rejectGCashPayment(
      db,
      actorId,
      rejected.payment.id,
      "Unclear screenshot",
    );

    const toReverse = await postPayment(db, actorId, {
      subscriberId: subscriberIds[42]!,
      amountCentavos: 59900n,
      method: "Cash",
      receivedAt: new Date("2026-09-23T10:00:00Z"),
      idempotencyKey: "pay-to-reverse",
      allowManual: false,
      notes: "Posted to wrong account",
    });
    await reversePayment(
      db,
      actorId,
      toReverse.payment.id,
      "Reversal — posted to wrong account",
    );

    console.log("Suspension / reconnection scenarios…");
    const susp1 = await createSuspension(db, actorId, {
      serviceAccountId: serviceAccountIds[0]!,
      reason: "Long overdue balance",
      effectiveDate: "2026-09-01",
      notes: "Completed reconnection scenario",
    });
    const recon1 = await createReconnection(db, actorId, {
      serviceAccountId: serviceAccountIds[0]!,
      suspensionId: susp1.id,
      feeCentavos: "0",
      technicianUserId: adminId,
      notes: "Completed reconnection",
    });
    await completeReconnection(db, actorId, recon1.id, "Reconnect complete");

    await createSuspension(db, actorId, {
      serviceAccountId: serviceAccountIds[1]!,
      reason: "Pending reconnection",
      effectiveDate: "2026-09-15",
    });
    await createReconnection(db, actorId, {
      serviceAccountId: serviceAccountIds[1]!,
      feeCentavos: "20000",
      technicianUserId: adminId,
      notes: "Pending reconnection",
    });

    console.log("Collection batches…");
    const balanced = await createCollectionBatch(db, actorId, {
      collectorUserId: collector1Id,
      collectionAreaId: areas[0]!.id,
      notes: "Balanced remittance batch",
      accounts: [
        {
          subscriberId: subscriberIds[20]!,
          expectedCentavos: "100000",
        },
      ],
    });
    await startCollectionBatch(db, actorId, balanced.id);
    await recordBatchCollection(db, actorId, balanced.id, {
      subscriberId: subscriberIds[20]!,
      collectedCentavos: "100000",
      isCash: true,
      notes: "House collection",
    });
    await submitCollectionBatch(db, actorId, balanced.id);
    await remitCollectionBatch(db, actorId, balanced.id, {
      remittedCashCentavos: "100000",
    });
    await reconcileCollectionBatch(db, actorId, balanced.id);
    await closeCollectionBatch(db, actorId, balanced.id);

    const shortage = await createCollectionBatch(db, actorId, {
      collectorUserId: collector2Id,
      collectionAreaId: areas[1]!.id,
      notes: "Short remittance batch",
      accounts: [
        {
          subscriberId: subscriberIds[21]!,
          expectedCentavos: "200000",
        },
      ],
    });
    await startCollectionBatch(db, actorId, shortage.id);
    await recordBatchCollection(db, actorId, shortage.id, {
      subscriberId: subscriberIds[21]!,
      collectedCentavos: "200000",
      isCash: true,
    });
    await submitCollectionBatch(db, actorId, shortage.id);
    await remitCollectionBatch(db, actorId, shortage.id, {
      remittedCashCentavos: "195000",
      shortageReason: "Collector reported short cash count",
    });
    await reconcileCollectionBatch(db, actorId, shortage.id);
    await closeCollectionBatch(db, actorId, shortage.id);

    console.log("Seed complete.");
    console.log(
      "Lab users: owner, admin, cashier, supervisor, auditor, collector1, collector2",
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
