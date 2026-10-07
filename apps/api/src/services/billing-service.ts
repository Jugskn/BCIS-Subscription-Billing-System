import {
  and,
  count,
  desc,
  eq,
  ilike,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  billingCycles,
  invoices,
  invoiceItems,
  ledgerEntries,
  serviceAccounts,
  subscribers,
  subscriberCredits,
  type Database,
} from "@bcis/db";
import {
  applyCreditToInvoice,
  buildSubscriptionLine,
  centavosToString,
  computeDueDate,
  computeInvoiceTotals,
  computeOverdueStatus,
  deriveOpenInvoiceStatus,
  isBillableForPeriod,
  type InvoiceStatus,
} from "@bcis/shared";
import { AppError } from "../lib/errors.js";
import { writeAuditLog } from "../lib/audit.js";
import { nextAccountNumber } from "../lib/account-number.js";
import { getGraceDays } from "./settings-service.js";

type Tx = Parameters<Parameters<Database["db"]["transaction"]>[0]>[0];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function toListItem(row: {
  invoice: typeof invoices.$inferSelect;
  subscriberName: string;
  subscriberAccountNumber: string;
  serviceAccountNumber: string;
}) {
  return {
    id: row.invoice.id,
    invoiceNumber: row.invoice.invoiceNumber,
    billingPeriod: row.invoice.billingPeriod,
    subscriberId: row.invoice.subscriberId,
    subscriberName: row.subscriberName,
    subscriberAccountNumber: row.subscriberAccountNumber,
    serviceAccountNumber: row.serviceAccountNumber,
    status: row.invoice.status,
    dueDate: row.invoice.dueDate,
    totalCentavos: centavosToString(row.invoice.totalCentavos),
    paidCentavos: centavosToString(row.invoice.paidCentavos),
    balanceCentavos: centavosToString(row.invoice.balanceCentavos),
    issuedAt: row.invoice.issuedAt.toISOString(),
  };
}

async function refreshInvoiceStatus(
  tx: Tx,
  invoiceId: string,
  graceDays: number,
): Promise<void> {
  const [inv] = await tx
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1);
  if (!inv || inv.status === "VOID" || inv.status === "CREDITED") return;

  const status = deriveOpenInvoiceStatus(
    inv.totalCentavos,
    inv.paidCentavos,
    inv.dueDate,
    graceDays,
    todayIso(),
  ) as InvoiceStatus;

  if (status !== inv.status) {
    await tx
      .update(invoices)
      .set({ status, updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId));
  }
}

export async function previewBillingGeneration(
  db: Database["db"],
  billingPeriod: string,
) {
  const accounts = await db
    .select({
      id: serviceAccounts.id,
      accountNumber: serviceAccounts.accountNumber,
      subscriberId: serviceAccounts.subscriberId,
      subscriberName: subscribers.fullName,
      collectionAreaId: subscribers.collectionAreaId,
      currentRateCentavos: serviceAccounts.currentRateCentavos,
      dueDay: serviceAccounts.dueDay,
      status: serviceAccounts.status,
      billingStartDate: serviceAccounts.billingStartDate,
    })
    .from(serviceAccounts)
    .innerJoin(subscribers, eq(serviceAccounts.subscriberId, subscribers.id));

  const existing = await db
    .select({
      serviceAccountId: invoices.serviceAccountId,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.billingPeriod, billingPeriod),
        ne(invoices.status, "VOID"),
      ),
    );

  const billedSet = new Set(existing.map((r) => r.serviceAccountId));
  const eligible = accounts.filter((a) =>
    isBillableForPeriod(
      { status: a.status, billingStartDate: a.billingStartDate },
      billingPeriod,
    ),
  );

  let estimatedTotal = 0n;
  const previewAccounts = eligible.map((a) => {
    const alreadyBilled = billedSet.has(a.id);
    if (!alreadyBilled) estimatedTotal += a.currentRateCentavos;
    return {
      serviceAccountId: a.id,
      accountNumber: a.accountNumber,
      subscriberName: a.subscriberName,
      collectionAreaId: a.collectionAreaId,
      rateCentavos: centavosToString(a.currentRateCentavos),
      dueDay: a.dueDay,
      alreadyBilled,
    };
  });

  const dueDate = computeDueDate(
    billingPeriod,
    eligible[0]?.dueDay ?? 15,
  );

  return {
    billingPeriod,
    dueDate,
    eligibleCount: eligible.filter((a) => !billedSet.has(a.id)).length,
    estimatedTotalCentavos: centavosToString(estimatedTotal),
    accounts: previewAccounts,
  };
}

export async function generateBillingForPeriod(
  db: Database["db"],
  actorUserId: string,
  billingPeriod: string,
) {
  return db.transaction(async (tx) => {
    let [cycle] = await tx
      .select()
      .from(billingCycles)
      .where(eq(billingCycles.billingPeriod, billingPeriod))
      .limit(1);

    if (!cycle) {
      [cycle] = await tx
        .insert(billingCycles)
        .values({ billingPeriod, status: "OPEN" })
        .returning();
    }

    const accounts = await tx
      .select({
        account: serviceAccounts,
        subscriberName: subscribers.fullName,
      })
      .from(serviceAccounts)
      .innerJoin(subscribers, eq(serviceAccounts.subscriberId, subscribers.id))
      .where(eq(serviceAccounts.status, "ACTIVE"));

    const existingRows = await tx
      .select({ serviceAccountId: invoices.serviceAccountId })
      .from(invoices)
      .where(
        and(
          eq(invoices.billingPeriod, billingPeriod),
          ne(invoices.status, "VOID"),
        ),
      );
    const billedSet = new Set(existingRows.map((r) => r.serviceAccountId));

    const created: string[] = [];
    const skipped: string[] = [];

    for (const { account } of accounts) {
      if (
        !isBillableForPeriod(
          {
            status: account.status,
            billingStartDate: account.billingStartDate,
          },
          billingPeriod,
        )
      ) {
        continue;
      }

      if (billedSet.has(account.id)) {
        skipped.push(account.id);
        continue;
      }

      const line = buildSubscriptionLine(
        account.currentRateCentavos,
        `Subscription — ${billingPeriod}`,
      );
      const totals = computeInvoiceTotals([line]);
      const dueDate = computeDueDate(billingPeriod, account.dueDay);

      const [creditRow] = await tx
        .select()
        .from(subscriberCredits)
        .where(eq(subscriberCredits.subscriberId, account.subscriberId))
        .limit(1)
        .for("update");

      const unapplied = creditRow?.unappliedCentavos ?? 0n;
      const creditResult = applyCreditToInvoice(totals.totalCentavos, unapplied);

      const invoiceNumber = await nextAccountNumber(tx, "INV");

      const [invoice] = await tx
        .insert(invoices)
        .values({
          invoiceNumber,
          serviceAccountId: account.id,
          subscriberId: account.subscriberId,
          billingCycleId: cycle!.id,
          billingPeriod,
          status: creditResult.status,
          dueDate,
          subtotalCentavos: totals.subtotalCentavos,
          discountCentavos: totals.discountCentavos,
          penaltyCentavos: totals.penaltyCentavos,
          adjustmentCentavos: totals.adjustmentCentavos,
          totalCentavos: totals.totalCentavos,
          paidCentavos: creditResult.paidCentavos,
          creditAppliedCentavos: creditResult.creditAppliedCentavos,
          balanceCentavos: creditResult.balanceCentavos,
        })
        .returning();

      if (!invoice) throw new AppError(500, "INTERNAL_ERROR", "Invoice insert failed.");

      await tx.insert(invoiceItems).values({
        invoiceId: invoice.id,
        itemType: line.itemType,
        description: line.description,
        rateCentavos: line.rateCentavos,
        quantity: line.quantity ?? 1,
        amountCentavos: line.amountCentavos,
      });

      if (totals.totalCentavos > 0n) {
        await tx.insert(ledgerEntries).values({
          subscriberId: account.subscriberId,
          serviceAccountId: account.id,
          entryDate: todayIso(),
          referenceType: "INVOICE",
          referenceId: invoice.id,
          description: invoiceNumber,
          debitCentavos: totals.totalCentavos,
          creditCentavos: 0n,
        });
      }

      if (creditResult.creditAppliedCentavos > 0n) {
        await tx.insert(ledgerEntries).values({
          subscriberId: account.subscriberId,
          serviceAccountId: account.id,
          entryDate: todayIso(),
          referenceType: "CREDIT_APPLICATION",
          referenceId: invoice.id,
          description: `Credit applied to ${invoiceNumber}`,
          debitCentavos: 0n,
          creditCentavos: creditResult.creditAppliedCentavos,
        });

        if (creditRow) {
          await tx
            .update(subscriberCredits)
            .set({
              unappliedCentavos: creditResult.remainingCreditCentavos,
              updatedAt: new Date(),
            })
            .where(eq(subscriberCredits.subscriberId, account.subscriberId));
        } else {
          await tx.insert(subscriberCredits).values({
            subscriberId: account.subscriberId,
            unappliedCentavos: creditResult.remainingCreditCentavos,
          });
        }
      }

      billedSet.add(account.id);
      created.push(invoice.id);
    }

    await tx
      .update(billingCycles)
      .set({
        status: "GENERATED",
        generatedAt: new Date(),
        generatedBy: actorUserId,
      })
      .where(eq(billingCycles.id, cycle!.id));

    await writeAuditLog(tx, {
      actorUserId,
      action: "billing.generate",
      entityType: "billing_cycle",
      entityId: cycle!.id,
      newValues: {
        billingPeriod,
        createdCount: created.length,
        skippedCount: skipped.length,
      },
    });

    return {
      billingPeriod,
      createdCount: created.length,
      skippedCount: skipped.length,
      invoiceIds: created,
    };
  });
}

export async function listInvoices(
  db: Database["db"],
  query: {
    page: number;
    pageSize: number;
    billingPeriod?: string;
    status?: string;
    subscriberId?: string;
    serviceAccountId?: string;
    search?: string;
  },
) {
  const offset = (query.page - 1) * query.pageSize;
  const filters = [];

  if (query.billingPeriod) {
    filters.push(eq(invoices.billingPeriod, query.billingPeriod));
  }
  if (query.status) {
    filters.push(eq(invoices.status, query.status as InvoiceStatus));
  }
  if (query.subscriberId) {
    filters.push(eq(invoices.subscriberId, query.subscriberId));
  }
  if (query.serviceAccountId) {
    filters.push(eq(invoices.serviceAccountId, query.serviceAccountId));
  }
  if (query.search) {
    const term = `%${query.search}%`;
    filters.push(
      or(
        ilike(invoices.invoiceNumber, term),
        ilike(subscribers.fullName, term),
        ilike(subscribers.accountNumber, term),
        ilike(serviceAccounts.accountNumber, term),
      ),
    );
  }

  const where = filters.length ? and(...filters) : undefined;

  const [totalRow] = await db
    .select({ total: count() })
    .from(invoices)
    .innerJoin(subscribers, eq(invoices.subscriberId, subscribers.id))
    .innerJoin(serviceAccounts, eq(invoices.serviceAccountId, serviceAccounts.id))
    .where(where);

  const rows = await db
    .select({
      invoice: invoices,
      subscriberName: subscribers.fullName,
      subscriberAccountNumber: subscribers.accountNumber,
      serviceAccountNumber: serviceAccounts.accountNumber,
    })
    .from(invoices)
    .innerJoin(subscribers, eq(invoices.subscriberId, subscribers.id))
    .innerJoin(serviceAccounts, eq(invoices.serviceAccountId, serviceAccounts.id))
    .where(where)
    .orderBy(desc(invoices.issuedAt))
    .limit(query.pageSize)
    .offset(offset);

  const graceDays = await getGraceDays(db);
  for (const row of rows) {
    if (
      row.invoice.status !== "VOID" &&
      row.invoice.status !== "PAID" &&
      row.invoice.status !== "CREDITED"
    ) {
      const newStatus = computeOverdueStatus(
        row.invoice.dueDate,
        graceDays,
        todayIso(),
        row.invoice.status as InvoiceStatus,
      );
      if (newStatus !== row.invoice.status) {
        row.invoice.status = newStatus;
      }
    }
  }

  return {
    items: rows.map(toListItem),
    page: query.page,
    pageSize: query.pageSize,
    total: totalRow?.total ?? 0,
  };
}

export async function getInvoice(db: Database["db"], id: string) {
  const rows = await db
    .select({
      invoice: invoices,
      subscriberName: subscribers.fullName,
      subscriberAccountNumber: subscribers.accountNumber,
      serviceAccountNumber: serviceAccounts.accountNumber,
    })
    .from(invoices)
    .innerJoin(subscribers, eq(invoices.subscriberId, subscribers.id))
    .innerJoin(serviceAccounts, eq(invoices.serviceAccountId, serviceAccounts.id))
    .where(eq(invoices.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) throw new AppError(404, "NOT_FOUND", "Invoice not found.");

  const items = await db
    .select()
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, id));

  const graceDays = await getGraceDays(db);
  let status = row.invoice.status as InvoiceStatus;
  if (status !== "VOID" && status !== "PAID" && status !== "CREDITED") {
    status = computeOverdueStatus(
      row.invoice.dueDate,
      graceDays,
      todayIso(),
      status,
    );
  }

  return {
    ...toListItem(row),
    serviceAccountId: row.invoice.serviceAccountId,
    status,
    subtotalCentavos: centavosToString(row.invoice.subtotalCentavos),
    discountCentavos: centavosToString(row.invoice.discountCentavos),
    penaltyCentavos: centavosToString(row.invoice.penaltyCentavos),
    adjustmentCentavos: centavosToString(row.invoice.adjustmentCentavos),
    creditAppliedCentavos: centavosToString(row.invoice.creditAppliedCentavos),
    voidReason: row.invoice.voidReason,
    voidedAt: row.invoice.voidedAt?.toISOString() ?? null,
    items: items.map((item) => ({
      id: item.id,
      itemType: item.itemType,
      description: item.description,
      rateCentavos: centavosToString(item.rateCentavos),
      quantity: item.quantity,
      amountCentavos: centavosToString(item.amountCentavos),
    })),
  };
}

export async function getCurrentBillingCycle(db: Database["db"]) {
  const now = new Date();
  const billingPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  let [cycle] = await db
    .select()
    .from(billingCycles)
    .where(eq(billingCycles.billingPeriod, billingPeriod))
    .limit(1);

  if (!cycle) {
    [cycle] = await db
      .insert(billingCycles)
      .values({ billingPeriod, status: "OPEN" })
      .returning();
  }

  const [stats] = await db
    .select({
      invoiceCount: count(),
      totalCentavos: sql<bigint>`coalesce(sum(${invoices.totalCentavos}), 0)`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.billingPeriod, billingPeriod),
        ne(invoices.status, "VOID"),
      ),
    );

  return {
    id: cycle!.id,
    billingPeriod: cycle!.billingPeriod,
    status: cycle!.status,
    generatedAt: cycle!.generatedAt?.toISOString() ?? null,
    invoiceCount: stats?.invoiceCount ?? 0,
    totalCentavos: centavosToString(stats?.totalCentavos ?? 0n),
  };
}

export { refreshInvoiceStatus };
