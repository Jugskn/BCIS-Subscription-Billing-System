import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, ensureCashierUser } from "./helpers.js";

describe("collection batches acceptance", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>["app"];
  let ownerToken: string;
  let collectorUserId: string;
  let subscriberId: string;
  let collectionAreaId: string;
  let cashierToken: string;

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

    const collectors = await app.inject({
      method: "GET",
      url: "/collectors/options",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const body = collectors.json() as
      | { items: { id: string }[] }
      | { id: string }[];
    const items = Array.isArray(body) ? body : (body.items ?? []);
    if (items[0]) {
      collectorUserId = items[0].id;
    } else {
      const me = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      collectorUserId = (me.json() as { user: { id: string } }).user.id;
    }

    const area = await app.inject({
      method: "POST",
      url: "/collection-areas",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        code: `BAT-${Date.now()}`,
        name: "Batch Test Area",
        description: "Collection batch acceptance area",
      },
    });
    expect(area.statusCode).toBe(201);
    collectionAreaId = (area.json() as { id: string }).id;

    const sub = await app.inject({
      method: "POST",
      url: "/subscribers",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        fullName: "Batch Test Subscriber",
        address: "Batch Lane",
        dueDay: 10,
        collectorUserId,
        collectionAreaId,
      },
    });
    expect(sub.statusCode).toBe(201);
    subscriberId = (sub.json() as { id: string }).id;

    const cashier = await ensureCashierUser("cashier_collection_assignments");
    const cashierLogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: cashier,
    });
    expect(cashierLogin.statusCode).toBe(200);
    cashierToken = (cashierLogin.json() as { token: string }).token;
  });

  afterAll(async () => {
    await app.close();
  });

  async function flowToRemit(remitted: string, shortageReason?: string) {
    // SPEC AT-07/AT-08: collected ₱20,000 (2_000_000 centavos)
    const collectedCentavos = "2000000";
    const create = await app.inject({
      method: "POST",
      url: "/collection-batches",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        collectorUserId,
        collectionAreaId,
        notes: "AT batch",
        accounts: [
          { subscriberId, expectedCentavos: collectedCentavos },
        ],
      },
    });
    expect(create.statusCode).toBe(201);
    const batchId = (create.json() as { id: string }).id;

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/collection-batches/${batchId}/start`,
          headers: { authorization: `Bearer ${ownerToken}` },
        })
      ).statusCode,
    ).toBe(200);

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/collection-batches/${batchId}/collections`,
          headers: { authorization: `Bearer ${ownerToken}` },
          payload: {
            subscriberId,
            collectedCentavos,
            isCash: true,
          },
        })
      ).statusCode,
    ).toBe(200);

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/collection-batches/${batchId}/submit`,
          headers: { authorization: `Bearer ${ownerToken}` },
        })
      ).statusCode,
    ).toBe(200);

    const remit = await app.inject({
      method: "POST",
      url: `/collection-batches/${batchId}/remit`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        remittedCashCentavos: remitted,
        ...(shortageReason ? { shortageReason } : {}),
      },
    });
    expect(remit.statusCode).toBe(200);

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/collection-batches/${batchId}/reconcile`,
          headers: { authorization: `Bearer ${ownerToken}` },
        })
      ).statusCode,
    ).toBe(200);

    const close = await app.inject({
      method: "POST",
      url: `/collection-batches/${batchId}/close`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    return { batchId, close, remit };
  }

  it("AT-07 Balanced remittance", async () => {
    const { batchId, close, remit } = await flowToRemit("2000000");
    const body = remit.json() as {
      differenceCentavos: string | null;
      status: string;
    };
    expect(body.differenceCentavos).toBe("0");
    expect(close.statusCode).toBe(200);
    expect((close.json() as { status: string }).status).toBe("CLOSED");

    const detail = await app.inject({
      method: "GET",
      url: `/collection-batches/${batchId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(detail.statusCode).toBe(200);
    const detailBody = detail.json() as {
      accountCount: number;
      accounts: Array<{
        subscriberAccountNumber: string;
        subscriberName: string;
        subscriberAddress: string;
        collectedCentavos: string;
      }>;
    };
    expect(detailBody.accountCount).toBe(1);
    expect(detailBody.accounts).toHaveLength(1);
    expect(detailBody.accounts[0]).toMatchObject({
      subscriberName: "Batch Test Subscriber",
      subscriberAddress: "Batch Lane",
      collectedCentavos: "2000000",
    });

    const forbiddenClose = await app.inject({
      method: "POST",
      url: `/collection-batches/${batchId}/close`,
      headers: { authorization: `Bearer ${cashierToken}` },
    });
    expect(forbiddenClose.statusCode).toBe(403);
  });

  it("AT-08 Collector shortage", async () => {
    const { close, remit } = await flowToRemit(
      "1950000",
      "Demo shortage — short cash count",
    );
    const body = remit.json() as {
      differenceCentavos: string | null;
      shortageReason: string | null;
    };
    // ₱20,000 collected − ₱19,500 remitted = ₱500 shortage
    expect(body.differenceCentavos).toBe("-50000");
    expect(body.shortageReason).toBeTruthy();
    expect(close.statusCode).toBe(200);

    // Cannot silently close as balanced without reason.
    const create = await app.inject({
      method: "POST",
      url: "/collection-batches",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        collectorUserId,
        accounts: [{ subscriberId, expectedCentavos: "2000000" }],
      },
    });
    const batchId = (create.json() as { id: string }).id;
    await app.inject({
      method: "POST",
      url: `/collection-batches/${batchId}/start`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    await app.inject({
      method: "POST",
      url: `/collection-batches/${batchId}/collections`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        subscriberId,
        collectedCentavos: "2000000",
        isCash: true,
      },
    });
    await app.inject({
      method: "POST",
      url: `/collection-batches/${batchId}/submit`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const badRemit = await app.inject({
      method: "POST",
      url: `/collection-batches/${batchId}/remit`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { remittedCashCentavos: "1950000" },
    });
    expect(badRemit.statusCode).toBe(400);
  });

  it("assigns areas with authorization, audit-safe behavior, and summaries", async () => {
    const forbidden = await app.inject({
      method: "POST",
      url: `/collectors/${collectorUserId}/areas`,
      headers: { authorization: `Bearer ${cashierToken}` },
      payload: { collectionAreaId },
    });
    expect(forbidden.statusCode).toBe(403);

    const assign = await app.inject({
      method: "POST",
      url: `/collectors/${collectorUserId}/areas`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { collectionAreaId },
    });
    expect(assign.statusCode).toBe(201);

    const duplicate = await app.inject({
      method: "POST",
      url: `/collectors/${collectorUserId}/areas`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { collectionAreaId },
    });
    expect(duplicate.statusCode).toBe(409);

    const summaries = await app.inject({
      method: "GET",
      url: "/collectors?page=1&pageSize=100",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(summaries.statusCode).toBe(200);
    const summary = (
      summaries.json() as {
        items: Array<{
          collectorUserId: string;
          assignedAreas: Array<{ id: string }>;
          subscriberCount: number;
          openBatchCount: number;
          currentMonthCollectedCentavos: string;
          remittanceDifferenceCentavos: string;
        }>;
      }
    ).items.find((item) => item.collectorUserId === collectorUserId);
    expect(summary).toBeDefined();
    expect(summary?.assignedAreas).toContainEqual(
      expect.objectContaining({ id: collectionAreaId }),
    );
    expect(summary?.subscriberCount).toBeGreaterThanOrEqual(1);
    expect(summary?.currentMonthCollectedCentavos).toMatch(/^-?\d+$/);
    expect(summary?.remittanceDifferenceCentavos).toMatch(/^-?\d+$/);

    const filteredBatches = await app.inject({
      method: "GET",
      url: `/collection-batches?collectionAreaId=${collectionAreaId}&page=1&pageSize=100`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(filteredBatches.statusCode).toBe(200);
    const filteredItems = (
      filteredBatches.json() as {
        items: Array<{ collectionAreaId: string | null; accountCount: number }>;
      }
    ).items;
    expect(filteredItems.length).toBeGreaterThanOrEqual(1);
    expect(
      filteredItems.every(
        (item) =>
          item.collectionAreaId === collectionAreaId && item.accountCount >= 1,
      ),
    ).toBe(true);

    const unassign = await app.inject({
      method: "DELETE",
      url: `/collectors/${collectorUserId}/areas/${collectionAreaId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(unassign.statusCode).toBe(200);
  });

  it("returns paginated subscriber collection history and assignments", async () => {
    const history = await app.inject({
      method: "GET",
      url: `/subscribers/${subscriberId}/collection-history?page=1&pageSize=10`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(history.statusCode).toBe(200);
    const body = history.json() as {
      assignedArea: { id: string } | null;
      assignedCollector: { id: string } | null;
      items: Array<{
        batchNumber: string;
        collectedCentavos: string;
        paymentId: string | null;
      }>;
      total: number;
    };
    expect(body.assignedArea?.id).toBe(collectionAreaId);
    expect(body.assignedCollector?.id).toBe(collectorUserId);
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.items[0]?.batchNumber).toBeTruthy();
    expect(body.items[0]?.collectedCentavos).toMatch(/^\d+$/);
  });
});
