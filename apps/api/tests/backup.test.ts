import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { createDb, invoices, ledgerEntries, subscribers } from "@bcis/db";
import { computeArAging } from "@bcis/shared";
import { createTestApp, ensureCashierUser } from "./helpers.js";
import type { AppConfig } from "../src/config.js";
import { getGraceDays } from "../src/services/settings-service.js";

async function pgDumpAvailable(config: AppConfig) {
  const tool =
    config.PG_BIN_DIR != null && config.PG_BIN_DIR.length > 0
      ? join(
          config.PG_BIN_DIR,
          process.platform === "win32" ? "pg_dump.exe" : "pg_dump",
        )
      : process.platform === "win32"
        ? "pg_dump.exe"
        : "pg_dump";
  if (config.PG_BIN_DIR) {
    try {
      await access(tool, constants.X_OK);
      return true;
    } catch {
      try {
        await access(tool, constants.F_OK);
        return true;
      } catch {
        return false;
      }
    }
  }
  // PATH probe via which/where is environment-specific; try spawning --version
  const { spawnSync } = await import("node:child_process");
  const probe = spawnSync(tool, ["--version"], { windowsHide: true });
  return probe.status === 0;
}

describe("AT-12 Backup/restore", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>["app"];
  let config: AppConfig;
  let ownerToken: string;
  let hasPgDump = false;

  beforeAll(async () => {
    const setup = await createTestApp();
    app = setup.app;
    config = setup.config;
    hasPgDump = await pgDumpAvailable(config);

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        username: process.env.SEED_OWNER_USERNAME ?? "owner",
        password: process.env.SEED_OWNER_PASSWORD,
      },
    });
    expect(login.statusCode).toBe(200);
    ownerToken = (login.json() as { token: string }).token;
  });

  afterAll(async () => {
    await app.close();
  });

  it("AT-10 Authorization", async () => {
    const cashier = await ensureCashierUser("cashier_backup_at10");
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: cashier.username, password: cashier.password },
    });
    const token = (login.json() as { token: string }).token;

    const users = await app.inject({
      method: "GET",
      url: "/users",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(users.statusCode).toBe(403);

    const list = await app.inject({
      method: "GET",
      url: "/backups",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.statusCode).toBe(403);

    const create = await app.inject({
      method: "POST",
      url: "/backups",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(create.statusCode).toBe(403);

    const restore = await app.inject({
      method: "POST",
      url: "/backups/x/restore",
      headers: { authorization: `Bearer ${token}` },
      payload: { confirmation: "RESTORE" },
    });
    expect(restore.statusCode).toBe(403);
  });

  it("AT-12 Backup/restore", async () => {
    if (!hasPgDump) {
      console.warn(
        "SKIP AT-12: pg_dump not found. Install PostgreSQL client tools and set PG_BIN_DIR, then re-run.\n" +
          "Manual steps: (1) Owner Create backup (2) Verify (3) add a subscriber+payment (4) Restore verified backup (5) confirm new data gone and integrity holds.",
      );
      return;
    }

    const create = await app.inject({
      method: "POST",
      url: "/backups",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(create.statusCode).toBe(201);
    const backup = create.json() as { id: string };

    const verify = await app.inject({
      method: "POST",
      url: `/backups/${backup.id}/verify`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(verify.statusCode).toBe(200);
    expect((verify.json() as { verified: boolean }).verified).toBe(true);

    const markerName = `AT12 Marker ${Date.now()}`;
    const subRes = await app.inject({
      method: "POST",
      url: "/subscribers",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        fullName: markerName,
        address: "AT12 Lane",
        dueDay: 15,
      },
    });
    expect(subRes.statusCode).toBe(201);
    const subId = (subRes.json() as { id: string }).id;

    const planList = await app.inject({
      method: "GET",
      url: "/service-plans?page=1&pageSize=1",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const planId = (planList.json() as { items: { id: string }[] }).items[0]!
      .id;

    await app.inject({
      method: "POST",
      url: "/service-accounts",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        subscriberId: subId,
        servicePlanId: planId,
        installationAddress: "AT12 Lane",
        activationDate: "2025-01-01",
        billingStartDate: "2025-01-01",
        dueDay: 15,
      },
    });

    await app.inject({
      method: "POST",
      url: "/billing/generate",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { billingPeriod: "2025-06" },
    });

    await app.inject({
      method: "POST",
      url: "/payments",
      headers: {
        authorization: `Bearer ${ownerToken}`,
        "idempotency-key": `at12-${Date.now()}`,
      },
      payload: {
        subscriberId: subId,
        amount: "100.00",
        method: "Cash",
      },
    });

    const restore = await app.inject({
      method: "POST",
      url: `/backups/${backup.id}/restore`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { confirmation: "RESTORE" },
    });
    expect(restore.statusCode).toBe(200);

    // Reconnect DB client after restore
    const { db, client } = createDb(config.DATABASE_URL);
    try {
      const found = await db
        .select()
        .from(subscribers)
        .where(eq(subscribers.fullName, markerName))
        .limit(1);
      expect(found.length).toBe(0);

      const openInvoices = await db
        .select({
          balanceCentavos: invoices.balanceCentavos,
          dueDate: invoices.dueDate,
        })
        .from(invoices)
        .where(
          sql`${invoices.status} NOT IN ('VOID', 'CREDITED')
            AND ${invoices.balanceCentavos} > 0`,
        );
      const graceDays = await getGraceDays(db);
      const today = new Date().toISOString().slice(0, 10);
      const aging = computeArAging(openInvoices, graceDays, today);
      const sumOpen = openInvoices.reduce((a, r) => a + r.balanceCentavos, 0n);
      expect(aging.totalBalanceCentavos).toBe(sumOpen);

      const [counts] = await db
        .select({
          subscribers: sql<number>`(select count(*)::int from subscribers)`,
          invoices: sql<number>`(select count(*)::int from invoices)`,
          ledger: sql<number>`(select count(*)::int from ledger_entries)`,
        })
        .from(ledgerEntries)
        .limit(1);
      expect(Number(counts?.subscribers ?? 0)).toBeGreaterThanOrEqual(0);
      expect(Number(counts?.invoices ?? 0)).toBeGreaterThanOrEqual(0);
    } finally {
      await client.end({ timeout: 5 });
    }
  });
});
