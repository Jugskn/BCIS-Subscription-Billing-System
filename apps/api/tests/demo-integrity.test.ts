import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, ilike, sql } from "drizzle-orm";
import {
  applicationSettings,
  createDb,
  invoices,
  ledgerEntries,
  receipts,
  subscriberCredits,
  subscribers,
} from "@bcis/db";
import { computeArAging } from "@bcis/shared";
import { loadConfig } from "../src/config.js";
import { getGraceDays } from "../src/services/settings-service.js";

describe("demo integrity", () => {
  let db: ReturnType<typeof createDb>["db"];
  let client: ReturnType<typeof createDb>["client"];
  let hasDemo = false;

  beforeAll(async () => {
    const config = loadConfig();
    const conn = createDb(config.DATABASE_URL);
    db = conn.db;
    client = conn.client;
    const demo = await db
      .select({ key: applicationSettings.key })
      .from(applicationSettings)
      .where(eq(applicationSettings.key, "demo_seed_v1"))
      .limit(1);
    hasDemo = demo.length > 0;
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  it("per subscriber: ledger debits - credits == open invoice balances - unapplied credit", async () => {
    if (!hasDemo) return;
    const subs = await db
      .select({ id: subscribers.id })
      .from(subscribers)
      .where(ilike(subscribers.notes, "%fictional demo%"));
    for (const sub of subs) {
      const [ledger] = await db
        .select({
          debits: sql<string>`coalesce(sum(${ledgerEntries.debitCentavos}), 0)`,
          credits: sql<string>`coalesce(sum(${ledgerEntries.creditCentavos}), 0)`,
        })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.subscriberId, sub.id));

      const [open] = await db
        .select({
          balance: sql<string>`coalesce(sum(${invoices.balanceCentavos}), 0)`,
        })
        .from(invoices)
        .where(
          sql`${invoices.subscriberId} = ${sub.id}
            AND ${invoices.status} NOT IN ('VOID', 'CREDITED')
            AND ${invoices.balanceCentavos} > 0`,
        );

      const [credit] = await db
        .select()
        .from(subscriberCredits)
        .where(eq(subscriberCredits.subscriberId, sub.id))
        .limit(1);

      const netLedger =
        BigInt(ledger?.debits ?? "0") - BigInt(ledger?.credits ?? "0");
      const openBal = BigInt(open?.balance ?? "0");
      const unapplied = credit?.unappliedCentavos ?? 0n;
      expect(
        netLedger,
        `subscriber ${sub.id}: ledger net ${netLedger} vs open ${openBal} - credit ${unapplied}`,
      ).toBe(openBal - unapplied);
    }
  });

  it("AR aging total == sum of open invoice balances", async () => {
    if (!hasDemo) return;
    const graceDays = await getGraceDays(db);
    const today = new Date().toISOString().slice(0, 10);
    const openInvoices = await db
      .select({
        balanceCentavos: invoices.balanceCentavos,
        dueDate: invoices.dueDate,
      })
      .from(invoices)
      .innerJoin(subscribers, eq(invoices.subscriberId, subscribers.id))
      .where(
        sql`${invoices.status} NOT IN ('VOID', 'CREDITED')
          AND ${invoices.balanceCentavos} > 0
          AND ${subscribers.notes} ILIKE '%fictional demo%'`,
      );

    const sumOpen = openInvoices.reduce((a, r) => a + r.balanceCentavos, 0n);
    const aging = computeArAging(openInvoices, graceDays, today);
    expect(aging.totalBalanceCentavos).toBe(sumOpen);
  });

  it("no duplicate receipt or invoice numbers", async () => {
    const allInv = await db.select({ n: invoices.invoiceNumber }).from(invoices);
    expect(new Set(allInv.map((r) => r.n)).size).toBe(allInv.length);

    const allRcpt = await db
      .select({ n: receipts.receiptNumber })
      .from(receipts);
    expect(new Set(allRcpt.map((r) => r.n)).size).toBe(allRcpt.length);
  });
});
