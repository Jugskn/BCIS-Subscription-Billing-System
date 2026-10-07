import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, serviceAccounts, servicePlans } from "@bcis/db";
import { centavosToString } from "@bcis/shared";
import { createTestApp, ensureCashierUser } from "./helpers.js";
import { loadConfig } from "../src/config.js";

describe("subscribers and services API", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>["app"];
  let ownerToken: string;
  let cashierToken: string;
  let planId: string;
  let areaId: string;

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

    const cashier = await ensureCashierUser();
    const cashierLogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: cashier.username, password: cashier.password },
    });
    cashierToken = (cashierLogin.json() as { token: string }).token;

    const planList = await app.inject({
      method: "GET",
      url: "/service-plans?page=1&pageSize=5",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(planList.statusCode).toBe(200);
    const plans = (planList.json() as { items: { id: string }[] }).items;
    expect(plans.length).toBeGreaterThan(0);
    planId = plans[0]!.id;

    const areaRes = await app.inject({
      method: "POST",
      url: "/collection-areas",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { code: "TEST-AREA", name: "Test Area" },
    });
    if (areaRes.statusCode === 201) {
      areaId = (areaRes.json() as { id: string }).id;
    } else {
      const list = await app.inject({
        method: "GET",
        url: "/collection-areas?page=1&pageSize=10",
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      areaId = (list.json() as { items: { id: string; code: string }[] }).items.find(
        (a) => a.code === "TEST-AREA",
      )!.id;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects invalid subscriber payload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/subscribers",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { fullName: "", address: "X", dueDay: 15 },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as {
      error: { code: string; message: string; issues: { field: string; message: string }[] };
    };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(body.error.issues)).toBe(true);
    expect(body.error.issues.some((i) => i.field === "fullName")).toBe(true);
  });

  it("creates collection area with empty description", async () => {
    const code = `EMPTY-DESC-${Date.now().toString(36).toUpperCase()}`;
    const res = await app.inject({
      method: "POST",
      url: "/collection-areas",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { code, name: "Empty Description Area", description: "" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { code: string; description: string };
    expect(body.code).toBe(code);
    expect(body.description).toBe("");
  });

  it("options endpoints return data without pagination params", async () => {
    const headers = { authorization: `Bearer ${ownerToken}` };

    const subscribers = await app.inject({
      method: "GET",
      url: "/subscribers/options",
      headers,
    });
    expect(subscribers.statusCode).toBe(200);
    const subItems = subscribers.json() as Array<{
      id: string;
      accountNumber: string;
      fullName: string;
    }>;
    expect(Array.isArray(subItems)).toBe(true);
    expect(subItems.length).toBeLessThanOrEqual(50);
    if (subItems[0]) {
      expect(subItems[0]).toHaveProperty("accountNumber");
      expect(subItems[0]).toHaveProperty("fullName");
      expect(subItems[0]).not.toHaveProperty("page");
    }

    const plans = await app.inject({
      method: "GET",
      url: "/plans/options",
      headers,
    });
    expect(plans.statusCode).toBe(200);
    expect(Array.isArray(plans.json())).toBe(true);

    const areas = await app.inject({
      method: "GET",
      url: "/areas/options",
      headers,
    });
    expect(areas.statusCode).toBe(200);
    expect(Array.isArray(areas.json())).toBe(true);

    const collectors = await app.inject({
      method: "GET",
      url: "/collectors/options",
      headers,
    });
    expect(collectors.statusCode).toBe(200);
    expect(Array.isArray(collectors.json())).toBe(true);

    const withSearch = await app.inject({
      method: "GET",
      url: "/areas/options?search=TEST",
      headers,
    });
    expect(withSearch.statusCode).toBe(200);
  });

  it("area edit persists name and description", async () => {
    const code = `EDIT-AREA-${Date.now().toString(36).toUpperCase()}`;
    const create = await app.inject({
      method: "POST",
      url: "/collection-areas",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { code, name: "Before Edit", description: "old desc" },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json() as { id: string };

    const update = await app.inject({
      method: "PUT",
      url: `/collection-areas/${created.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "After Edit",
        description: "new description",
      },
    });
    expect(update.statusCode).toBe(200);
    const updated = update.json() as {
      id: string;
      name: string;
      description: string;
    };
    expect(updated.name).toBe("After Edit");
    expect(updated.description).toBe("new description");

    const list = await app.inject({
      method: "GET",
      url: `/collection-areas?page=1&pageSize=100&search=${encodeURIComponent(code)}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(list.statusCode).toBe(200);
    const found = (
      list.json() as { items: Array<{ id: string; name: string; description: string }> }
    ).items.find((a) => a.id === created.id);
    expect(found?.name).toBe("After Edit");
    expect(found?.description).toBe("new description");
  });

  it("rejects list queries above pageSize 100", async () => {
    const headers = { authorization: `Bearer ${ownerToken}` };
    const urls = [
      "/subscribers?page=1&pageSize=101",
      "/collection-areas?page=1&pageSize=200",
      "/service-plans?page=1&pageSize=150",
      "/service-accounts?page=1&pageSize=101",
    ];
    for (const url of urls) {
      const res = await app.inject({ method: "GET", url, headers });
      expect(res.statusCode).toBe(400);
      const body = res.json() as {
        error: { code: string; issues?: { message: string }[] };
      };
      expect(body.error.code).toBe("VALIDATION_ERROR");
      const messages = (body.error.issues ?? []).map((i) => i.message).join(" ");
      expect(messages.toLowerCase()).toMatch(/100|too big|<=/);
    }
  });

  it("creates subscriber with unique account number", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/subscribers",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        fullName: "Synthetic Test User",
        contactPhone: "09171234567",
        address: "123 Test Street, Malaybalay",
        collectionAreaId: areaId,
        dueDay: 15,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { accountNumber: string; id: string };
    expect(body.accountNumber).toMatch(/^SUB-\d{6}$/);

    const dup = await app.inject({
      method: "POST",
      url: "/subscribers",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        fullName: "Synthetic Test User Two",
        address: "456 Test Avenue",
        dueDay: 20,
      },
    });
    const body2 = dup.json() as { accountNumber: string };
    expect(body2.accountNumber).not.toBe(body.accountNumber);
  });

  it("global search finds subscriber by name", async () => {
    await app.inject({
      method: "POST",
      url: "/subscribers",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        fullName: "Trgm Search Unique Name XYZ",
        address: "Search Blvd",
        dueDay: 10,
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/subscribers/search?q=Trgm+Search+Unique&page=1&pageSize=10",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: { fullName: string }[]; total: number };
    expect(body.total).toBeGreaterThan(0);
    expect(body.items.some((i) => i.fullName.includes("Trgm Search Unique"))).toBe(
      true,
    );
  });

  it("records service event on status change", async () => {
    const subRes = await app.inject({
      method: "POST",
      url: "/subscribers",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        fullName: "Service Event Test",
        address: "Event Lane",
        dueDay: 5,
      },
    });
    const subscriberId = (subRes.json() as { id: string }).id;

    const saRes = await app.inject({
      method: "POST",
      url: "/service-accounts",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        subscriberId,
        servicePlanId: planId,
        installationAddress: "Event Lane Unit 2",
        activationDate: "2025-01-01",
        billingStartDate: "2025-01-01",
        dueDay: 5,
      },
    });
    expect(saRes.statusCode).toBe(201);
    const account = saRes.json() as {
      id: string;
      accountNumber: string;
      currentRateCentavos: string;
    };
    expect(account.accountNumber).toMatch(/^SVC-\d{6}$/);

    const updateRes = await app.inject({
      method: "PUT",
      url: `/service-accounts/${account.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { status: "SUSPENDED", statusReason: "Test suspension" },
    });
    expect(updateRes.statusCode).toBe(200);

    const eventsRes = await app.inject({
      method: "GET",
      url: `/service-accounts/${account.id}/events`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const events = eventsRes.json() as Array<{
      oldStatus: string | null;
      newStatus: string | null;
    }>;
    expect(events.some((e) => e.newStatus === "ACTIVE" && e.oldStatus === null)).toBe(
      true,
    );
    expect(events.some((e) => e.newStatus === "SUSPENDED" && e.oldStatus === "ACTIVE")).toBe(
      true,
    );
  });

  it("plan price change does not alter existing service account rate", async () => {
    const config = loadConfig();
    const { db, client } = createDb(config.DATABASE_URL);

    const subRes = await app.inject({
      method: "POST",
      url: "/subscribers",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        fullName: "Rate Snapshot Test",
        address: "Rate Road",
        dueDay: 12,
      },
    });
    const subscriberId = (subRes.json() as { id: string }).id;

    const [plan] = await db
      .select()
      .from(servicePlans)
      .where(eq(servicePlans.id, planId))
      .limit(1);

    const saRes = await app.inject({
      method: "POST",
      url: "/service-accounts",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        subscriberId,
        servicePlanId: planId,
        installationAddress: "Rate Road",
        activationDate: "2025-02-01",
        billingStartDate: "2025-02-01",
        dueDay: 12,
      },
    });
    const accountId = (saRes.json() as { id: string }).id;
    const originalRate = centavosToString(plan!.priceCentavos);

    const priceUpdate = await app.inject({
      method: "PUT",
      url: `/service-plans/${planId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { price: "1299.00" },
    });
    expect(priceUpdate.statusCode).toBe(200);

    const [row] = await db
      .select()
      .from(serviceAccounts)
      .where(eq(serviceAccounts.id, accountId))
      .limit(1);

    expect(centavosToString(row!.currentRateCentavos)).toBe(originalRate);

    await client.end({ timeout: 5 });
  });

  it("cashier cannot create subscribers (AT-10)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/subscribers",
      headers: { authorization: `Bearer ${cashierToken}` },
      payload: {
        fullName: "Blocked User",
        address: "Nowhere",
        dueDay: 1,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects duplicate plan code", async () => {
    const code = `DUP-PLAN-${Date.now()}`;
    const payload = {
      serviceTypeCode: "INTERNET",
      code,
      name: "Duplicate Test",
      price: "500",
      speedMbps: 25,
    };
    const first = await app.inject({
      method: "POST",
      url: "/service-plans",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload,
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/service-plans",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { ...payload, name: "Duplicate Test 2" },
    });
    expect(second.statusCode).toBe(409);
  });
});
