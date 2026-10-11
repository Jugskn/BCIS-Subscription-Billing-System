import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { applicationSettings, createDb } from "@bcis/db";
import { createTestApp } from "./helpers.js";
import { loadConfig } from "../src/config.js";
import {
  getSuspensionThresholdCentavos,
  invalidateSettingsCache,
} from "../src/services/settings-service.js";
import {
  listOutstandingReceivables,
  listSuspensionCandidates,
  sumOpenInvoiceBalances,
  getArAgingSummary,
} from "../src/services/receivables-service.js";

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

describe("receivables outstanding / overdue / suspension candidates", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>["app"];
  let ownerToken: string;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    ownerToken = await login(
      app,
      process.env.SEED_OWNER_USERNAME ?? "owner",
      process.env.SEED_OWNER_PASSWORD ?? "",
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it("aging total equals sum of open invoice balances and outstanding footer", async () => {
    const aging = await app.inject({
      method: "GET",
      url: "/receivables/aging",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(aging.statusCode).toBe(200);
    const agingBody = aging.json() as { totalBalanceCentavos: string };

    const outstanding = await app.inject({
      method: "GET",
      url: "/receivables/outstanding?page=1&pageSize=100",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(outstanding.statusCode).toBe(200);
    const outBody = outstanding.json() as {
      totals: { balanceCentavos: string };
      items: Array<{ currentBalanceCentavos: string }>;
    };

    expect(outBody.totals.balanceCentavos).toBe(agingBody.totalBalanceCentavos);

    const config = loadConfig();
    const { db, client } = createDb(config.DATABASE_URL);
    try {
      const openSum = await sumOpenInvoiceBalances(db);
      expect(openSum).toBe(BigInt(agingBody.totalBalanceCentavos));

      const summary = await getArAgingSummary(db);
      expect(summary.totalBalanceCentavos).toBe(agingBody.totalBalanceCentavos);

      const listed = await listOutstandingReceivables(db, {
        page: 1,
        pageSize: 100,
      });
      expect(listed.totals.balanceCentavos).toBe(agingBody.totalBalanceCentavos);
    } finally {
      await client.end({ timeout: 5 });
    }
  });

  it("suspension candidates query respects threshold", async () => {
    const config = loadConfig();
    const { db, client } = createDb(config.DATABASE_URL);
    try {
      const original = await getSuspensionThresholdCentavos(db);

      // Within SETTING_DEFS max (100_000_000_000 centavos).
      const unreachable = 100_000_000_000;
      await db
        .insert(applicationSettings)
        .values({
          key: "suspension_threshold_centavos",
          value: unreachable,
        })
        .onConflictDoUpdate({
          target: applicationSettings.key,
          set: { value: unreachable, updatedAt: new Date() },
        });
      await db
        .insert(applicationSettings)
        .values({
          key: "suspension_threshold_months",
          value: 0,
        })
        .onConflictDoUpdate({
          target: applicationSettings.key,
          set: { value: 0, updatedAt: new Date() },
        });
      invalidateSettingsCache();

      const high = await listSuspensionCandidates(db, {
        page: 1,
        pageSize: 100,
      });
      expect(high.thresholdCentavos).toBe(String(unreachable));
      expect(high.total).toBe(0);
      expect(high.items.every((i) => i.status === "ACTIVE")).toBe(true);

      await db
        .insert(applicationSettings)
        .values({
          key: "suspension_threshold_centavos",
          value: 0,
        })
        .onConflictDoUpdate({
          target: applicationSettings.key,
          set: { value: 0, updatedAt: new Date() },
        });
      invalidateSettingsCache();

      const low = await listSuspensionCandidates(db, {
        page: 1,
        pageSize: 100,
      });
      expect(low.thresholdCentavos).toBe("0");
      for (const item of low.items) {
        expect(item.status).toBe("ACTIVE");
        expect(BigInt(item.totalArrearsCentavos)).toBeGreaterThan(0n);
      }

      // Restore prior threshold (or default seed value)
      const restoreValue =
        typeof original === "bigint" ? Number(original) : 200_000;
      await db
        .update(applicationSettings)
        .set({ value: restoreValue, updatedAt: new Date() })
        .where(eq(applicationSettings.key, "suspension_threshold_centavos"));
      await db
        .insert(applicationSettings)
        .values({ key: "suspension_threshold_months", value: 3 })
        .onConflictDoUpdate({
          target: applicationSettings.key,
          set: { value: 3, updatedAt: new Date() },
        });
      invalidateSettingsCache();
    } finally {
      await client.end({ timeout: 5 });
    }

    const apiRes = await app.inject({
      method: "GET",
      url: "/receivables/suspension-candidates?page=1&pageSize=50",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(apiRes.statusCode).toBe(200);
    const body = apiRes.json() as {
      thresholdCentavos: string;
      items: Array<{ status: string; totalArrearsCentavos: string }>;
    };
    expect(body.thresholdCentavos).toBeTruthy();
    for (const item of body.items) {
      expect(item.status).toBe("ACTIVE");
      expect(BigInt(item.totalArrearsCentavos)).toBeGreaterThan(
        BigInt(body.thresholdCentavos),
      );
    }
  });

  it("overdue list requires receivable.view and rejects pageSize > 100", async () => {
    const bad = await app.inject({
      method: "GET",
      url: "/receivables/overdue?page=1&pageSize=101",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(bad.statusCode).toBe(400);

    const ok = await app.inject({
      method: "GET",
      url: "/receivables/overdue?page=1&pageSize=50",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json() as { pageSize: number; items: unknown[] };
    expect(body.pageSize).toBeLessThanOrEqual(100);
  });
});
