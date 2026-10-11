import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  createDb,
  ledgerEntries,
  roles,
  userRoles,
  users,
} from "@bcis/db";
import * as argon2 from "argon2";
import { createTestApp } from "./helpers.js";
import { loadConfig } from "../src/config.js";

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
  const body = res.json() as { token: string };
  return body.token;
}

async function ensureViewerUser() {
  const config = loadConfig();
  const { db, client } = createDb(config.DATABASE_URL);
  try {
    const username = "viewer_report_test";
    const password = "ViewerPass123!";
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    let userId = existing[0]?.id;
    if (!userId) {
      const [row] = await db
        .insert(users)
        .values({
          username,
          passwordHash: await argon2.hash(password),
          fullName: "Report Viewer",
          isActive: true,
        })
        .returning();
      userId = row!.id;
    } else {
      await db
        .update(users)
        .set({
          passwordHash: await argon2.hash(password),
          isActive: true,
          failedLoginAttempts: 0,
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
    }
    const [viewerRole] = await db
      .select()
      .from(roles)
      .where(eq(roles.name, "Viewer"))
      .limit(1);
    if (!viewerRole) throw new Error("Viewer role missing — run db:seed");
    await db.delete(userRoles).where(eq(userRoles.userId, userId));
    await db.insert(userRoles).values({ userId, roleId: viewerRole.id });
    return { username, password };
  } finally {
    await client.end({ timeout: 5 });
  }
}

describe("reports, aging, exports", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>["app"];
  let ownerToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    ownerToken = await login(
      app,
      process.env.SEED_OWNER_USERNAME ?? "owner",
      process.env.SEED_OWNER_PASSWORD ?? "",
    );
    const viewer = await ensureViewerUser();
    viewerToken = await login(app, viewer.username, viewer.password);
  });

  afterAll(async () => {
    await app.close();
  });

  it("AR aging total equals sum of open invoice balances", async () => {
    const aging = await app.inject({
      method: "GET",
      url: "/receivables/aging",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(aging.statusCode).toBe(200);
    const agingBody = aging.json() as {
      totalBalanceCentavos: string;
      buckets: Array<{ balanceCentavos: string }>;
    };

    const bucketSum = agingBody.buckets.reduce(
      (s, b) => s + BigInt(b.balanceCentavos),
      0n,
    );
    expect(bucketSum).toBe(BigInt(agingBody.totalBalanceCentavos));

    const summary = await app.inject({
      method: "GET",
      url: "/receivables/summary",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(summary.statusCode).toBe(200);
    const summaryBody = summary.json() as { totalOpenCentavos: string };
    expect(summaryBody.totalOpenCentavos).toBe(agingBody.totalBalanceCentavos);

    const report = await app.inject({
      method: "GET",
      url: "/reports/ar-aging?page=1&pageSize=100",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(report.statusCode).toBe(200);
    const reportBody = report.json() as {
      summary: { totalBalanceCentavos: string };
    };
    expect(reportBody.summary.totalBalanceCentavos).toBe(
      agingBody.totalBalanceCentavos,
    );
  });

  it("dashboard KPIs use the same receivable totals as receivables summary", async () => {
    const [dashRes, sumRes] = await Promise.all([
      app.inject({
        method: "GET",
        url: "/dashboard",
        headers: { authorization: `Bearer ${ownerToken}` },
      }),
      app.inject({
        method: "GET",
        url: "/receivables/summary",
        headers: { authorization: `Bearer ${ownerToken}` },
      }),
    ]);
    expect(dashRes.statusCode).toBe(200);
    expect(sumRes.statusCode).toBe(200);
    const dash = dashRes.json() as {
      kpis: {
        currentReceivableCentavos: string;
        overdueReceivableCentavos: string;
        subscribersOverdueCount: number;
      };
      arAging: { totalBalanceCentavos: string };
    };
    const sum = sumRes.json() as {
      currentReceivableCentavos: string;
      overdueReceivableCentavos: string;
      subscribersOverdueCount: number;
      totalOpenCentavos: string;
    };
    expect(dash.kpis.currentReceivableCentavos).toBe(
      sum.currentReceivableCentavos,
    );
    expect(dash.kpis.overdueReceivableCentavos).toBe(
      sum.overdueReceivableCentavos,
    );
    expect(dash.kpis.subscribersOverdueCount).toBe(sum.subscribersOverdueCount);
    expect(dash.arAging.totalBalanceCentavos).toBe(sum.totalOpenCentavos);
  });

  it("dashboard chart totals equal corresponding report totals", async () => {
    const dashRes = await app.inject({
      method: "GET",
      url: "/dashboard",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(dashRes.statusCode).toBe(200);
    const dash = dashRes.json() as {
      windows: {
        billingMonths: number;
        paymentMethodsFromDate: string;
        paymentMethodsToDate: string;
        collectorFromDate: string;
        collectorToDate: string;
      };
      billingVsCollection: Array<{
        billedCentavos: string;
        collectedCentavos: string;
      }>;
      paymentMethods: Array<{ amountCentavos: string }>;
      arAging: { totalBalanceCentavos: string };
      collectorPerformance: Array<{ collectedCentavos: string }>;
    };

    const billed = dash.billingVsCollection.reduce(
      (s, r) => s + BigInt(r.billedCentavos),
      0n,
    );
    const collected = dash.billingVsCollection.reduce(
      (s, r) => s + BigInt(r.collectedCentavos),
      0n,
    );
    const paymentTotal = dash.paymentMethods.reduce(
      (s, r) => s + BigInt(r.amountCentavos),
      0n,
    );
    const collectorTotal = dash.collectorPerformance.reduce(
      (s, r) => s + BigInt(r.collectedCentavos),
      0n,
    );

    const [billingRes, methodsRes, agingRes, collectorsRes] =
      await Promise.all([
        app.inject({
          method: "GET",
          url: `/reports/billing-vs-collection?months=${dash.windows.billingMonths}`,
          headers: { authorization: `Bearer ${ownerToken}` },
        }),
        app.inject({
          method: "GET",
          url: `/reports/payment-methods?page=1&pageSize=100&fromDate=${dash.windows.paymentMethodsFromDate}&toDate=${dash.windows.paymentMethodsToDate}`,
          headers: { authorization: `Bearer ${ownerToken}` },
        }),
        app.inject({
          method: "GET",
          url: "/reports/ar-aging?page=1&pageSize=100",
          headers: { authorization: `Bearer ${ownerToken}` },
        }),
        app.inject({
          method: "GET",
          url: `/reports/collectors?page=1&pageSize=100&fromDate=${dash.windows.collectorFromDate}&toDate=${dash.windows.collectorToDate}`,
          headers: { authorization: `Bearer ${ownerToken}` },
        }),
      ]);

    expect(billingRes.statusCode).toBe(200);
    expect(methodsRes.statusCode).toBe(200);
    expect(agingRes.statusCode).toBe(200);
    expect(collectorsRes.statusCode).toBe(200);

    const billing = billingRes.json() as {
      totals: { billedCentavos: string; collectedCentavos: string };
    };
    const methods = methodsRes.json() as {
      totals: { amountCentavos: string };
    };
    const aging = agingRes.json() as {
      summary: { totalBalanceCentavos: string };
    };
    const collectors = collectorsRes.json() as {
      totals: { collectedCentavos: string };
    };

    expect(billing.totals.billedCentavos).toBe(billed.toString());
    expect(billing.totals.collectedCentavos).toBe(collected.toString());
    expect(methods.totals.amountCentavos).toBe(paymentTotal.toString());
    expect(aging.summary.totalBalanceCentavos).toBe(
      dash.arAging.totalBalanceCentavos,
    );
    expect(collectors.totals.collectedCentavos).toBe(collectorTotal.toString());
  });

  it("report ledger closing balance equals sum of ledger debits−credits", async () => {
    const config = loadConfig();
    const { db, client } = createDb(config.DATABASE_URL);
    try {
      const [anyEntry] = await db
        .select({ subscriberId: ledgerEntries.subscriberId })
        .from(ledgerEntries)
        .limit(1);
      if (!anyEntry) {
        expect(true).toBe(true);
        return;
      }
      const subscriberId = anyEntry.subscriberId;
      const ledger = await db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.subscriberId, subscriberId));
      const ledgerBalance = ledger.reduce(
        (s, e) => s + e.debitCentavos - e.creditCentavos,
        0n,
      );

      const today = new Date().toISOString().slice(0, 10);
      const soa = await app.inject({
        method: "GET",
        url: `/reports/ledger?subscriberId=${subscriberId}&fromDate=2000-01-01&toDate=${today}&page=1&pageSize=100`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(soa.statusCode).toBe(200);
      const body = soa.json() as {
        totals: { closingBalanceCentavos: string };
      };
      expect(BigInt(body.totals.closingBalanceCentavos)).toBe(ledgerBalance);
    } finally {
      await client.end({ timeout: 5 });
    }
  });

  it("user without report.export gets 403 on export routes", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/reports/collections/export?format=xlsx&period=monthly",
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(res.statusCode).toBe(403);

    const preview = await app.inject({
      method: "GET",
      url: "/reports/collections?period=monthly&page=1&pageSize=20",
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(preview.statusCode).toBe(200);
  });

  it("XLSX and PDF export return valid non-empty files", async () => {
    const xlsx = await app.inject({
      method: "GET",
      url: "/reports/payment-methods/export?format=xlsx",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.headers["content-type"]).toContain(
      "spreadsheetml.sheet",
    );
    const xlsxBuf = Buffer.from(xlsx.rawPayload);
    expect(xlsxBuf.byteLength).toBeGreaterThan(100);
    // XLSX is a ZIP (PK..)
    expect(xlsxBuf[0]).toBe(0x50);
    expect(xlsxBuf[1]).toBe(0x4b);

    const pdf = await app.inject({
      method: "GET",
      url: "/reports/payment-methods/export?format=pdf",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    const pdfBuf = Buffer.from(pdf.rawPayload);
    expect(pdfBuf.byteLength).toBeGreaterThan(100);
    expect(pdfBuf.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });
});
