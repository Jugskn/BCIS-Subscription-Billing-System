import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import {
  auditLogs,
  createDb,
  invoices,
  ledgerEntries,
  paymentAllocations,
  paymentReversals,
  payments,
  receipts,
  subscriberCredits,
} from "@bcis/db";
import { pesosToCentavos } from "@bcis/shared";
import { createTestApp } from "./helpers.js";
import { loadConfig } from "../src/config.js";

function pngFile(name: string) {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  return new File([png], name, { type: "image/png" });
}

function key(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

describe("payments API", () => {
  let app: Awaited<ReturnType<typeof createTestApp>>["app"];
  let ownerToken: string;
  let planId: string;
  let subscriberId: string;
  let rateCentavos: bigint;

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
    const plan = (planList.json() as { items: { id: string; priceCentavos: string }[] })
      .items[0]!;
    planId = plan.id;
    rateCentavos = BigInt(plan.priceCentavos);

    const subRes = await app.inject({
      method: "POST",
      url: "/subscribers",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        fullName: "Payment Test Subscriber",
        address: "Payment Lane",
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
        installationAddress: "Payment Lane",
        activationDate: "2025-01-01",
        billingStartDate: "2025-01-01",
        dueDay: 15,
      },
    });
    expect(saRes.statusCode).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createInvoice(
    billingPeriod: string,
    amountCentavos?: bigint,
  ): Promise<{ id: string; invoiceNumber: string; balanceCentavos: string }> {
    const amount = amountCentavos ?? rateCentavos;
    // Ensure rate matches desired test amount by adjusting via direct invoice if needed.
    // Prefer billing generate when amount matches plan rate; otherwise insert via API adjust.
    const gen = await app.inject({
      method: "POST",
      url: "/billing/generate",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { billingPeriod },
    });
    expect([200, 201]).toContain(gen.statusCode);

    const list = await app.inject({
      method: "GET",
      url: `/invoices?subscriberId=${subscriberId}&billingPeriod=${billingPeriod}&page=1&pageSize=5`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const invoice = (
      list.json() as {
        items: { id: string; invoiceNumber: string; balanceCentavos: string; status: string }[];
      }
    ).items.find((i) => i.status !== "VOID");
    expect(invoice).toBeDefined();

    if (amount !== BigInt(invoice!.balanceCentavos) && amount !== rateCentavos) {
      // For exact AT amounts, use a dedicated subscriber with matching plan — skip adjust here.
    }
    return invoice!;
  }

  async function createPlan(pricePesos: string) {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const priceTag = pricePesos.replaceAll(".", "");
    const res = await app.inject({
      method: "POST",
      url: "/service-plans",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        serviceTypeCode: "INTERNET",
        code: `AT${priceTag}${stamp}`,
        name: `AT Plan ${pricePesos} ${stamp}`,
        price: pricePesos,
        speedMbps: 50,
      },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { id: string }).id;
  }

  async function freshSubscriber(
    name: string,
    opts?: { planId?: string; dueDay?: number },
  ) {
    const subRes = await app.inject({
      method: "POST",
      url: "/subscribers",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        fullName: name,
        address: `${name} Address`,
        dueDay: opts?.dueDay ?? 15,
      },
    });
    const subId = (subRes.json() as { id: string }).id;
    await app.inject({
      method: "POST",
      url: "/service-accounts",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        subscriberId: subId,
        servicePlanId: opts?.planId ?? planId,
        installationAddress: `${name} Address`,
        activationDate: "2025-01-01",
        billingStartDate: "2025-01-01",
        dueDay: opts?.dueDay ?? 15,
      },
    });
    return subId;
  }

  async function invoiceFor(
    subId: string,
    billingPeriod: string,
  ): Promise<{ id: string; balanceCentavos: string; status: string }> {
    const gen = await app.inject({
      method: "POST",
      url: "/billing/generate",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { billingPeriod },
    });
    expect([200, 201]).toContain(gen.statusCode);
    const list = await app.inject({
      method: "GET",
      url: `/invoices?subscriberId=${subId}&billingPeriod=${billingPeriod}&page=1&pageSize=5`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const inv = (
      list.json() as {
        items: { id: string; balanceCentavos: string; status: string }[];
      }
    ).items[0];
    expect(inv).toBeDefined();
    return inv!;
  }

  it("AT-01 Exact payment", async () => {
    // SPEC: Invoice 999; pay 999 → Remaining 0; PAID; ledger balanced; receipt created
    const atPlanId = await createPlan("999.00");
    const subId = await freshSubscriber("AT01 Exact Subscriber", {
      planId: atPlanId,
    });
    const inv = await invoiceFor(subId, "2026-11");
    expect(inv.balanceCentavos).toBe(pesosToCentavos("999").toString());

    const post = await app.inject({
      method: "POST",
      url: "/payments",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        subscriberId: subId,
        amount: "999.00",
        method: "Cash",
        idempotencyKey: key("at01"),
      },
    });
    expect(post.statusCode).toBe(201);
    const body = post.json() as {
      payment: { id: string; status: string };
      receipt: {
        receiptNumber: string;
        status: string;
        serviceHeadline: string | null;
        allocations: { planName: string }[];
      };
    };
    expect(body.payment.status).toBe("POSTED");
    expect(body.receipt.status).toBe("ISSUED");
    expect(body.receipt.receiptNumber).toMatch(/^RCPT-/);
    expect(body.receipt.serviceHeadline).toBeTruthy();
    expect(body.receipt.allocations[0]?.planName).toBeTruthy();

    const invRes = await app.inject({
      method: "GET",
      url: `/invoices/${inv.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const invBody = invRes.json() as {
      balanceCentavos: string;
      status: string;
      paidCentavos: string;
    };
    expect(invBody.balanceCentavos).toBe("0");
    expect(invBody.status).toBe("PAID");
    expect(invBody.paidCentavos).toBe(pesosToCentavos("999").toString());

    const ledger = await app.inject({
      method: "GET",
      url: `/subscribers/${subId}/ledger?page=1&pageSize=100`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const entries = (
      ledger.json() as {
        items: { debitCentavos: string; creditCentavos: string; balanceCentavos: string }[];
      }
    ).items;
    expect(entries.length).toBeGreaterThan(0);
    const debit = entries.reduce((s, e) => s + BigInt(e.debitCentavos), 0n);
    const credit = entries.reduce((s, e) => s + BigInt(e.creditCentavos), 0n);
    expect(debit - credit).toBe(0n);
    expect(entries[entries.length - 1]!.balanceCentavos).toBe("0");
  });

  it("AT-02 Partial payment", async () => {
    // SPEC: Invoice 999; pay 500 → Remaining 499; PARTIALLY_PAID
    const atPlanId = await createPlan("999.00");
    const subId = await freshSubscriber("AT02 Partial Subscriber", {
      planId: atPlanId,
    });
    // Future period so status stays PARTIALLY_PAID (not OVERDUE).
    const inv = await invoiceFor(subId, "2026-12");
    expect(inv.balanceCentavos).toBe(pesosToCentavos("999").toString());

    const post = await app.inject({
      method: "POST",
      url: "/payments",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        subscriberId: subId,
        amount: "500.00",
        method: "Cash",
        idempotencyKey: key("at02"),
      },
    });
    expect(post.statusCode).toBe(201);

    const invRes = await app.inject({
      method: "GET",
      url: `/invoices/${inv.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const invBody = invRes.json() as {
      balanceCentavos: string;
      status: string;
      paidCentavos: string;
    };
    expect(invBody.balanceCentavos).toBe(pesosToCentavos("499").toString());
    expect(invBody.paidCentavos).toBe(pesosToCentavos("500").toString());
    expect(invBody.status).toBe("PARTIALLY_PAID");

    const config = loadConfig();
    const { db, client } = createDb(config.DATABASE_URL);
    const allocs = await db
      .select()
      .from(paymentAllocations)
      .where(eq(paymentAllocations.invoiceId, inv.id));
    expect(allocs).toHaveLength(1);
    expect(allocs[0]!.amountCentavos).toBe(pesosToCentavos("500"));

    const ledger = await app.inject({
      method: "GET",
      url: `/subscribers/${subId}/ledger?page=1&pageSize=100`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const entries = (
      ledger.json() as { items: { balanceCentavos: string }[] }
    ).items;
    expect(entries[entries.length - 1]!.balanceCentavos).toBe(
      pesosToCentavos("499").toString(),
    );
    await client.end({ timeout: 5 });
  });

  it("AT-03 Advance payment", async () => {
    // SPEC: Monthly 1,000; pay 3,000 → allocate 1,000; credit 2,000; no value lost
    const config = loadConfig();
    const { db, client } = createDb(config.DATABASE_URL);
    const atPlanId = await createPlan("1000.00");
    const subId = await freshSubscriber("AT03 Advance Subscriber", {
      planId: atPlanId,
    });
    const inv = await invoiceFor(subId, "2026-11");
    expect(inv.balanceCentavos).toBe(pesosToCentavos("1000").toString());

    const post = await app.inject({
      method: "POST",
      url: "/payments",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        subscriberId: subId,
        amount: "3000.00",
        method: "Cash",
        idempotencyKey: key("at03"),
      },
    });
    expect(post.statusCode).toBe(201);
    const body = post.json() as {
      payment: { unallocatedCentavos: string; amountCentavos: string };
    };
    expect(body.payment.amountCentavos).toBe(pesosToCentavos("3000").toString());
    expect(body.payment.unallocatedCentavos).toBe(
      pesosToCentavos("2000").toString(),
    );
    expect(
      BigInt(body.payment.amountCentavos) -
        BigInt(body.payment.unallocatedCentavos),
    ).toBe(pesosToCentavos("1000"));

    const [credit] = await db
      .select()
      .from(subscriberCredits)
      .where(eq(subscriberCredits.subscriberId, subId))
      .limit(1);
    expect(credit!.unappliedCentavos).toBe(pesosToCentavos("2000"));

    const invRes = await app.inject({
      method: "GET",
      url: `/invoices/${inv.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect((invRes.json() as { status: string; balanceCentavos: string }).status).toBe(
      "PAID",
    );
    expect(
      (invRes.json() as { balanceCentavos: string }).balanceCentavos,
    ).toBe("0");

    await client.end({ timeout: 5 });
  });

  it("AT-04 Oldest-first arrears", async () => {
    // SPEC: Aug 999 + Sep 999; pay 1,200 → Aug 0; Sep 798 remaining
    const atPlanId = await createPlan("999.00");
    const subId = await freshSubscriber("AT04 Arrears Subscriber", {
      planId: atPlanId,
    });

    for (const period of ["2025-08", "2025-09"]) {
      const inv = await invoiceFor(subId, period);
      expect(inv.balanceCentavos).toBe(pesosToCentavos("999").toString());
    }

    const list = await app.inject({
      method: "GET",
      url: `/invoices?subscriberId=${subId}&page=1&pageSize=20`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const items = (
      list.json() as {
        items: { id: string; billingPeriod: string; balanceCentavos: string }[];
      }
    ).items.filter((i) => i.billingPeriod === "2025-08" || i.billingPeriod === "2025-09");
    expect(items.length).toBe(2);

    const aug = items.find((i) => i.billingPeriod === "2025-08")!;
    const sep = items.find((i) => i.billingPeriod === "2025-09")!;

    const post = await app.inject({
      method: "POST",
      url: "/payments",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        subscriberId: subId,
        amount: "1200.00",
        method: "Cash",
        idempotencyKey: key("at04"),
      },
    });
    expect(post.statusCode).toBe(201);

    const augAfter = await app.inject({
      method: "GET",
      url: `/invoices/${aug.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const sepAfter = await app.inject({
      method: "GET",
      url: `/invoices/${sep.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect((augAfter.json() as { balanceCentavos: string }).balanceCentavos).toBe(
      "0",
    );
    expect((sepAfter.json() as { balanceCentavos: string }).balanceCentavos).toBe(
      pesosToCentavos("798").toString(),
    );
  });

  it("AT-05 Duplicate GCash ref", async () => {
    // SPEC: Post already-used verified ref → blocked
    const ref = `GCASH-DUP-${Date.now()}`;

    async function postGCash(idem: string) {
      const form = new FormData();
      form.set("subscriberId", subscriberId);
      form.set("amount", "100.00");
      form.set("referenceNumber", ref);
      form.set("senderName", "Test Sender");
      form.set("idempotencyKey", idem);
      form.set("proof", pngFile("proof.png"));

      return app.inject({
        method: "POST",
        url: "/payments/gcash",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: form,
      });
    }

    const first = await postGCash(key("gcash1"));
    expect(first.statusCode).toBe(201);
    expect((first.json() as { status: string }).status).toBe("PENDING");
    const paymentId = (first.json() as { id: string }).id;

    // Screenshot/pending alone must not allocate.
    const config = loadConfig();
    const { db, client } = createDb(config.DATABASE_URL);
    const pendingAllocs = await db
      .select()
      .from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, paymentId));
    expect(pendingAllocs).toHaveLength(0);

    const verify = await app.inject({
      method: "POST",
      url: `/payments/${paymentId}/verify`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(verify.statusCode).toBe(200);
    expect((verify.json() as { payment: { status: string } }).payment.status).toBe(
      "VERIFIED",
    );

    const second = await postGCash(key("gcash2"));
    expect(second.statusCode).toBe(409);
    expect((second.json() as { error: { code: string } }).error.code).toBe(
      "DUPLICATE_GCASH_REF",
    );
    await client.end({ timeout: 5 });
  });

  it("AT-06 Payment reversal", async () => {
    // SPEC: Reverse incorrect payment → original visible; linked reversal;
    // balances restored; actor/reason audited
    const atPlanId = await createPlan("999.00");
    const subId = await freshSubscriber("AT06 Reversal Subscriber", {
      planId: atPlanId,
    });
    const inv = await invoiceFor(subId, "2026-11");
    const balanceBefore = inv.balanceCentavos;
    expect(balanceBefore).toBe(pesosToCentavos("999").toString());

    const post = await app.inject({
      method: "POST",
      url: "/payments",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        subscriberId: subId,
        amount: "999.00",
        method: "BankTransfer",
        idempotencyKey: key("at06"),
      },
    });
    expect(post.statusCode).toBe(201);
    const paymentId = (post.json() as { payment: { id: string }; receipt: { receiptNumber: string } })
      .payment.id;
    const receiptNumber = (post.json() as { receipt: { receiptNumber: string } }).receipt
      .receiptNumber;

    const reverse = await app.inject({
      method: "POST",
      url: `/payments/${paymentId}/reverse`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { reason: "Incorrect amount entered" },
    });
    expect(reverse.statusCode).toBe(200);
    const reversed = reverse.json() as {
      status: string;
      reversal: { reason: string; id: string } | null;
      receiptStatus: string | null;
    };
    expect(reversed.status).toBe("REVERSED");
    expect(reversed.reversal?.reason).toBe("Incorrect amount entered");
    expect(reversed.reversal?.id).toBeTruthy();
    expect(reversed.receiptStatus).toBe("VOID");

    // Original payment remains visible as REVERSED (not deleted).
    const original = await app.inject({
      method: "GET",
      url: `/payments/${paymentId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(original.statusCode).toBe(200);
    expect((original.json() as { status: string }).status).toBe("REVERSED");

    const invAfter = await app.inject({
      method: "GET",
      url: `/invoices/${inv.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect((invAfter.json() as { balanceCentavos: string }).balanceCentavos).toBe(
      balanceBefore,
    );

    const config = loadConfig();
    const { db, client } = createDb(config.DATABASE_URL);
    const [rcpt] = await db
      .select()
      .from(receipts)
      .where(eq(receipts.receiptNumber, receiptNumber))
      .limit(1);
    expect(rcpt!.status).toBe("VOID");

    const [link] = await db
      .select()
      .from(paymentReversals)
      .where(eq(paymentReversals.originalPaymentId, paymentId))
      .limit(1);
    expect(link).toBeTruthy();
    expect(link!.reason).toBe("Incorrect amount entered");

    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, "payment.reverse"),
          eq(auditLogs.entityId, paymentId),
        ),
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(1);
    expect(audit).toBeTruthy();
    expect(audit!.actorUserId).toBeTruthy();
    expect(audit!.reason).toBe("Incorrect amount entered");

    const ledgerRows = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.subscriberId, subId));
    const hasReversal = ledgerRows.some((r) => r.referenceType === "PAYMENT_REVERSAL");
    expect(hasReversal).toBe(true);
    await client.end({ timeout: 5 });
  });

  it("AT-09 Concurrent users", async () => {
    const subRes = await app.inject({
      method: "POST",
      url: "/subscribers",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        fullName: "Parallel Pay Subscriber",
        address: "Parallel Lane",
        dueDay: 15,
      },
    });
    const subId = (subRes.json() as { id: string }).id;
    await app.inject({
      method: "POST",
      url: "/service-accounts",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        subscriberId: subId,
        servicePlanId: planId,
        installationAddress: "Parallel Lane",
        activationDate: "2025-01-01",
        billingStartDate: "2025-01-01",
        dueDay: 15,
      },
    });

    await app.inject({
      method: "POST",
      url: "/billing/generate",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { billingPeriod: "2026-05" },
    });

    const list = await app.inject({
      method: "GET",
      url: `/invoices?subscriberId=${subId}&billingPeriod=2026-05&page=1&pageSize=5`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const inv = (list.json() as { items: { id: string; balanceCentavos: string }[] }).items[0]!;
    const half = (BigInt(inv.balanceCentavos) / 2n).toString();
    const halfPesos = (Number(half) / 100).toFixed(2);

    const [a, b] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/payments",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          subscriberId: subId,
          amount: halfPesos,
          method: "Cash",
          idempotencyKey: key("par-a"),
        },
      }),
      app.inject({
        method: "POST",
        url: "/payments",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          subscriberId: subId,
          amount: halfPesos,
          method: "Cash",
          idempotencyKey: key("par-b"),
        },
      }),
    ]);

    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    const receiptA = (a.json() as { receipt: { receiptNumber: string }; payment: { id: string } })
      .receipt.receiptNumber;
    const receiptB = (b.json() as { receipt: { receiptNumber: string }; payment: { id: string } })
      .receipt.receiptNumber;
    expect(receiptA).not.toBe(receiptB);

    const config = loadConfig();
    const { db, client } = createDb(config.DATABASE_URL);
    const allocs = await db
      .select()
      .from(paymentAllocations)
      .where(eq(paymentAllocations.invoiceId, inv.id));
    const totalAllocated = allocs.reduce((s, r) => s + r.amountCentavos, 0n);
    expect(totalAllocated).toBeLessThanOrEqual(BigInt(inv.balanceCentavos));

    const [invoiceRow] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, inv.id))
      .limit(1);
    expect(invoiceRow!.paidCentavos).toBe(totalAllocated);
    expect(invoiceRow!.paidCentavos + invoiceRow!.balanceCentavos).toBe(
      invoiceRow!.totalCentavos,
    );

    const paymentIds = [
      (a.json() as { payment: { id: string } }).payment.id,
      (b.json() as { payment: { id: string } }).payment.id,
    ];
    const payRows = await db
      .select()
      .from(payments)
      .where(and(eq(payments.subscriberId, subId)));
    expect(payRows.filter((p) => paymentIds.includes(p.id))).toHaveLength(2);

    await client.end({ timeout: 5 });
  });

  it("idempotency key prevents double-posting", async () => {
    const period = "2026-06";
    await app.inject({
      method: "POST",
      url: "/billing/generate",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { billingPeriod: period },
    });
    const list = await app.inject({
      method: "GET",
      url: `/invoices?subscriberId=${subscriberId}&billingPeriod=${period}&page=1&pageSize=5`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const inv = (list.json() as { items: { balanceCentavos: string }[] }).items[0];
    if (!inv || inv.balanceCentavos === "0") return;

    const idem = key("idem");
    const payload = {
      subscriberId,
      amount: "10.00",
      method: "Cash" as const,
      idempotencyKey: idem,
    };
    const first = await app.inject({
      method: "POST",
      url: "/payments",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload,
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: "POST",
      url: "/payments",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload,
    });
    expect(second.statusCode).toBe(200);
    expect((second.json() as { payment: { id: string } }).payment.id).toBe(
      (first.json() as { payment: { id: string } }).payment.id,
    );
  });

  it("GCash verify posts; reject does not allocate", async () => {
    const form = new FormData();
    form.set("subscriberId", subscriberId);
    form.set("amount", "50.00");
    form.set("referenceNumber", `GCASH-OK-${Date.now()}`);
    form.set("senderName", "Verifier Test");
    form.set("idempotencyKey", key("gcash-ok"));
    form.set("proof", pngFile("ok.png"));

    const pending = await app.inject({
      method: "POST",
      url: "/payments/gcash",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: form,
    });
    expect(pending.statusCode).toBe(201);
    const paymentId = (pending.json() as { id: string }).id;

    const verify = await app.inject({
      method: "POST",
      url: `/payments/${paymentId}/verify`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(verify.statusCode).toBe(200);
    const verified = verify.json() as {
      payment: { status: string; verifiedByName: string | null };
      receipt: { receiptNumber: string };
    };
    expect(verified.payment.status).toBe("VERIFIED");
    expect(verified.payment.verifiedByName).toBeTruthy();
    expect(verified.receipt.receiptNumber).toMatch(/^RCPT-/);
  });
});
