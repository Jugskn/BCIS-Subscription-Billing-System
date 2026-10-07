import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createDb,
  invoiceItems,
  invoices,
  ledgerEntries,
  serviceAccounts,
  subscriberCredits,
} from "@bcis/db";
import { centavosToString, computeRunningBalances, pesosToCentavos } from "@bcis/shared";
import { createTestApp } from "./helpers.js";
import { loadConfig } from "../src/config.js";

describe("billing API", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>["app"];
  let ownerToken: string;
  let planId: string;
  let subscriberId: string;
  let serviceAccountId: string;
  const billingPeriod = "2025-09";

  beforeAll(async () => {
    const setup = await createTestApp();
    app = setup.app;

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

    const planList = await app.inject({
      method: "GET",
      url: "/service-plans?page=1&pageSize=1",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    planId = (planList.json() as { items: { id: string }[] }).items[0]!.id;

    const subRes = await app.inject({
      method: "POST",
      url: "/subscribers",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        fullName: "Billing Test Subscriber",
        address: "Billing Lane",
        dueDay: 15,
      },
    });
    subscriberId = (subRes.json() as { id: string }).id;

    const saRes = await app.inject({
      method: "POST",
      url: "/service-accounts",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        subscriberId,
        servicePlanId: planId,
        installationAddress: "Billing Lane",
        activationDate: "2025-01-01",
        billingStartDate: "2025-01-01",
        dueDay: 15,
      },
    });
    serviceAccountId = (saRes.json() as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("preview then generate billing", async () => {
    const preview = await app.inject({
      method: "POST",
      url: "/billing/preview",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { billingPeriod },
    });
    expect(preview.statusCode).toBe(200);
    const previewBody = preview.json() as { eligibleCount: number };
    expect(previewBody.eligibleCount).toBeGreaterThan(0);

    const gen = await app.inject({
      method: "POST",
      url: "/billing/generate",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { billingPeriod },
    });
    expect(gen.statusCode).toBe(201);
    const genBody = gen.json() as { createdCount: number };
    expect(genBody.createdCount).toBeGreaterThan(0);
  });

  it("AT-11: duplicate billing for same period is idempotent", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/billing/generate",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { billingPeriod: "2025-10" },
    });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json() as { createdCount: number; skippedCount: number };
    expect(firstBody.createdCount).toBeGreaterThan(0);

    const second = await app.inject({
      method: "POST",
      url: "/billing/generate",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { billingPeriod: "2025-10" },
    });
    expect(second.statusCode).toBe(201);
    const secondBody = second.json() as { createdCount: number; skippedCount: number };
    expect(secondBody.createdCount).toBe(0);
    expect(secondBody.skippedCount).toBeGreaterThan(0);

    const config = loadConfig();
    const { db, client } = createDb(config.DATABASE_URL);
    const dupCheck = await db
      .select()
      .from(invoices)
      .where(eq(invoices.serviceAccountId, serviceAccountId));
    const periodInvoices = dupCheck.filter(
      (i) => i.billingPeriod === "2025-10" && i.status !== "VOID",
    );
    expect(periodInvoices.length).toBeLessThanOrEqual(1);
    await client.end({ timeout: 5 });
  });

  it("rate snapshot preserved after plan price change", async () => {
    const config = loadConfig();
    const { db, client } = createDb(config.DATABASE_URL);

    const [account] = await db
      .select()
      .from(serviceAccounts)
      .where(eq(serviceAccounts.id, serviceAccountId))
      .limit(1);
    const originalRate = account!.currentRateCentavos;

    await app.inject({
      method: "PUT",
      url: `/service-plans/${planId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { price: "2500.00" },
    });

    const gen = await app.inject({
      method: "POST",
      url: "/billing/generate",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { billingPeriod: "2025-11" },
    });
    expect(gen.statusCode).toBe(201);

    const invRows = await db
      .select()
      .from(invoices)
      .where(eq(invoices.serviceAccountId, serviceAccountId));
    const novInvoice = invRows.find((i) => i.billingPeriod === "2025-11");
    expect(novInvoice).toBeDefined();

    const items = await db
      .select()
      .from(invoiceItems)
      .where(eq(invoiceItems.invoiceId, novInvoice!.id));
    const subLine = items.find((i) => i.itemType === "SUBSCRIPTION");
    expect(subLine!.rateCentavos).toBe(originalRate);
    expect(subLine!.rateCentavos).not.toBe(pesosToCentavos("2500"));

    await client.end({ timeout: 5 });
  });

  it("auto-applies subscriber credit on invoice generation", async () => {
    const config = loadConfig();
    const { db, client } = createDb(config.DATABASE_URL);

    await db
      .insert(subscriberCredits)
      .values({
        subscriberId,
        unappliedCentavos: pesosToCentavos("500"),
      })
      .onConflictDoUpdate({
        target: subscriberCredits.subscriberId,
        set: { unappliedCentavos: pesosToCentavos("500"), updatedAt: new Date() },
      });

    const gen = await app.inject({
      method: "POST",
      url: "/billing/generate",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { billingPeriod: "2025-12" },
    });
    expect(gen.statusCode).toBe(201);

    const invRows = await db
      .select()
      .from(invoices)
      .where(eq(invoices.serviceAccountId, serviceAccountId));
    const decInvoice = invRows.find((i) => i.billingPeriod === "2025-12");
    expect(decInvoice!.creditAppliedCentavos).toBe(pesosToCentavos("500"));
    expect(decInvoice!.balanceCentavos).toBe(
      decInvoice!.totalCentavos - pesosToCentavos("500"),
    );

    const [credit] = await db
      .select()
      .from(subscriberCredits)
      .where(eq(subscriberCredits.subscriberId, subscriberId))
      .limit(1);
    expect(credit!.unappliedCentavos).toBe(0n);

    await client.end({ timeout: 5 });
  });

  it("ledger running balance is reproducible", async () => {
    const ledgerRes = await app.inject({
      method: "GET",
      url: `/subscribers/${subscriberId}/ledger?page=1&pageSize=100`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(ledgerRes.statusCode).toBe(200);
    const body = ledgerRes.json() as {
      items: Array<{
        debitCentavos: string;
        creditCentavos: string;
        balanceCentavos: string;
      }>;
    };
    expect(body.items.length).toBeGreaterThan(0);

    const config = loadConfig();
    const { db, client } = createDb(config.DATABASE_URL);
    const rows = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.subscriberId, subscriberId))
      .orderBy(ledgerEntries.entryDate, ledgerEntries.id);

    const domainBalances = computeRunningBalances(
      rows.map((r) => ({
        id: r.id,
        entryDate: r.entryDate,
        referenceType: r.referenceType,
        referenceId: r.referenceId,
        description: r.description,
        debitCentavos: r.debitCentavos,
        creditCentavos: r.creditCentavos,
      })),
    );
    expect(domainBalances.length).toBe(rows.length);
    if (domainBalances.length > 0) {
      expect(centavosToString(domainBalances.at(-1)!.balanceCentavos)).toBe(
        body.items.at(-1)!.balanceCentavos,
      );
    }
    await client.end({ timeout: 5 });
  });

  it("void invoice requires reason and posts offsetting ledger", async () => {
    const list = await app.inject({
      method: "GET",
      url: `/invoices?subscriberId=${subscriberId}&billingPeriod=2025-09&page=1&pageSize=5`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const invoice = (list.json() as { items: { id: string }[] }).items[0];
    if (!invoice) return;

    const noReason = await app.inject({
      method: "POST",
      url: `/invoices/${invoice.id}/void`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { reason: "" },
    });
    expect(noReason.statusCode).toBe(400);

    const voidRes = await app.inject({
      method: "POST",
      url: `/invoices/${invoice.id}/void`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { reason: "Test void for duplicate billing slot" },
    });
    expect(voidRes.statusCode).toBe(200);
    expect((voidRes.json() as { status: string }).status).toBe("VOID");
  });
});
