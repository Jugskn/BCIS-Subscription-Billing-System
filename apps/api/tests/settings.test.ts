import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, count, desc, eq } from "drizzle-orm";
import {
  applicationSettings,
  auditLogs,
  createDb,
  invoices,
  ledgerEntries,
} from "@bcis/db";
import { createTestApp, ensureCashierUser } from "./helpers.js";
import { loadConfig } from "../src/config.js";
import {
  getGraceDays,
  invalidateSettingsCache,
} from "../src/services/settings-service.js";

async function login(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  username: string,
  password: string,
) {
  const res = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { username, password },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { token: string }).token;
}

describe("application settings", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>["app"];
  let ownerToken: string;
  let cashierToken: string;
  let originalGrace: number;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    ownerToken = await login(
      app,
      process.env.SEED_OWNER_USERNAME ?? "owner",
      process.env.SEED_OWNER_PASSWORD ?? "",
    );
    const cashier = await ensureCashierUser("cashier_settings_test");
    cashierToken = await login(app, cashier.username, cashier.password);

    const cfg = loadConfig();
    const { db, client } = createDb(cfg.DATABASE_URL);
    try {
      originalGrace = await getGraceDays(db);
    } finally {
      await client.end({ timeout: 5 });
    }
  });

  afterAll(async () => {
    // Restore grace days so other suites stay stable.
    await app.inject({
      method: "PUT",
      url: "/settings",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { grace_days: originalGrace },
    });
    await app.close();
  });

  it("returns 403 when cashier PUTs settings", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/settings",
      headers: { authorization: `Bearer ${cashierToken}` },
      payload: { grace_days: 7 },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("rejects invalid values with issues array", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/settings",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { grace_days: -1 },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as {
      error: { code: string; issues?: Array<{ field: string; message: string }> };
    };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.issues?.some((i) => i.field === "grace_days")).toBe(true);
  });

  it("rejects unknown setting keys", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/settings",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { totally_unknown_key: 1 },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as {
      error: { issues?: Array<{ field: string }> };
    };
    expect(body.error.issues?.some((i) => i.field === "totally_unknown_key")).toBe(
      true,
    );
  });

  it("owner save persists and writes an audit entry", async () => {
    const target = originalGrace === 9 ? 8 : 9;
    const before = await app.inject({
      method: "GET",
      url: "/settings",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(before.statusCode).toBe(200);

    const put = await app.inject({
      method: "PUT",
      url: "/settings",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { grace_days: target },
    });
    expect(put.statusCode).toBe(200);
    const putBody = put.json() as {
      settings: { grace_days: number };
      changed: string[];
    };
    expect(putBody.settings.grace_days).toBe(target);
    expect(putBody.changed).toContain("grace_days");

    const cfg = loadConfig();
    const { db, client } = createDb(cfg.DATABASE_URL);
    try {
      invalidateSettingsCache();
      expect(await getGraceDays(db)).toBe(target);

      const [row] = await db
        .select()
        .from(applicationSettings)
        .where(eq(applicationSettings.key, "grace_days"))
        .limit(1);
      expect(row?.value).toBe(target);

      const [audit] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, "settings.update"),
            eq(auditLogs.entityType, "application_setting"),
            eq(auditLogs.entityId, "grace_days"),
          ),
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(1);
      expect(audit).toBeTruthy();
      expect((audit!.newValues as { grace_days?: number }).grace_days).toBe(
        target,
      );
    } finally {
      await client.end({ timeout: 5 });
    }
  });

  it("changing grace period changes which accounts are overdue", async () => {
    const highGrace = await app.inject({
      method: "PUT",
      url: "/settings",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { grace_days: 90 },
    });
    expect(highGrace.statusCode).toBe(200);

    const overdueHigh = await app.inject({
      method: "GET",
      url: "/receivables/overdue?page=1&pageSize=100",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(overdueHigh.statusCode).toBe(200);
    const highCount = (overdueHigh.json() as { total: number }).total;

    const lowGrace = await app.inject({
      method: "PUT",
      url: "/settings",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { grace_days: 0 },
    });
    expect(lowGrace.statusCode).toBe(200);

    const overdueLow = await app.inject({
      method: "GET",
      url: "/receivables/overdue?page=1&pageSize=100",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(overdueLow.statusCode).toBe(200);
    const lowCount = (overdueLow.json() as { total: number }).total;

    // With zero grace, at least as many accounts should be overdue as with 90-day grace.
    expect(lowCount).toBeGreaterThanOrEqual(highCount);
  });

  it("settings change never modifies existing invoices or ledger rows", async () => {
    const cfg = loadConfig();
    const { db, client } = createDb(cfg.DATABASE_URL);
    try {
      const [invBefore] = await db.select({ total: count() }).from(invoices);
      const [ledBefore] = await db.select({ total: count() }).from(ledgerEntries);

      const put = await app.inject({
        method: "PUT",
        url: "/settings",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          grace_days: 4,
          company_name: "BCIS Settings Integrity Lab",
        },
      });
      expect(put.statusCode).toBe(200);

      const [invAfter] = await db.select({ total: count() }).from(invoices);
      const [ledAfter] = await db.select({ total: count() }).from(ledgerEntries);
      expect(Number(invAfter?.total ?? 0)).toBe(Number(invBefore?.total ?? 0));
      expect(Number(ledAfter?.total ?? 0)).toBe(Number(ledBefore?.total ?? 0));
    } finally {
      await client.end({ timeout: 5 });
    }
  });
});
