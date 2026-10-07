import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
  aliasedTable,
} from "drizzle-orm";
import {
  invoices,
  ledgerEntries,
  paymentAllocations,
  paymentProofs,
  paymentReversals,
  payments,
  receipts,
  subscriberCredits,
  subscribers,
  users,
  type Database,
} from "@bcis/db";
import {
  allocateManual,
  allocateOldestFirst,
  centavosToString,
  deriveOpenInvoiceStatus,
  type AllocatableInvoice,
  type AllocationResult,
  type ManualAllocationInput,
  type PaymentMethod,
} from "@bcis/shared";
import { AppError } from "../lib/errors.js";
import { writeAuditLog } from "../lib/audit.js";
import { nextAccountNumber } from "../lib/account-number.js";
import { getGraceDays } from "./settings-service.js";

type Tx = Parameters<Parameters<Database["db"]["transaction"]>[0]>[0];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function entryDateFrom(receivedAt: Date): string {
  return receivedAt.toISOString().slice(0, 10);
}

async function loadOpenInvoices(
  db: Tx | Database["db"],
  subscriberId: string,
  forUpdate: boolean,
): Promise<(typeof invoices.$inferSelect)[]> {
  const q = db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.subscriberId, subscriberId),
        inArray(invoices.status, [
          "UNPAID",
          "PARTIALLY_PAID",
          "OVERDUE",
        ]),
        sql`${invoices.balanceCentavos} > 0`,
      ),
    )
    .orderBy(asc(invoices.dueDate), asc(invoices.invoiceNumber));

  if (forUpdate) {
    return q.for("update");
  }
  return q;
}

function toAllocatable(
  rows: (typeof invoices.$inferSelect)[],
): AllocatableInvoice[] {
  return rows.map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    balanceCentavos: inv.balanceCentavos,
    sortDate: inv.dueDate,
    billingPeriod: inv.billingPeriod,
  }));
}

function runAllocation(
  paymentCentavos: bigint,
  openInvoices: AllocatableInvoice[],
  manual?: ManualAllocationInput[],
): AllocationResult {
  if (manual && manual.length > 0) {
    return allocateManual(paymentCentavos, openInvoices, manual);
  }
  return allocateOldestFirst(paymentCentavos, openInvoices);
}

async function applyAllocationToInvoices(
  tx: Tx,
  allocation: AllocationResult,
  invoiceRows: (typeof invoices.$inferSelect)[],
  graceDays: number,
): Promise<void> {
  const byId = new Map(invoiceRows.map((r) => [r.id, r]));
  for (const line of allocation.allocations) {
    const inv = byId.get(line.invoiceId);
    if (!inv) {
      throw new AppError(409, "CONFLICT", "Invoice no longer available for allocation.");
    }
    const paidCentavos = inv.paidCentavos + line.allocatedCentavos;
    const balanceCentavos = inv.totalCentavos - paidCentavos;
    const status = deriveOpenInvoiceStatus(
      inv.totalCentavos,
      paidCentavos,
      inv.dueDate,
      graceDays,
      todayIso(),
    );
    await tx
      .update(invoices)
      .set({
        paidCentavos,
        balanceCentavos: balanceCentavos < 0n ? 0n : balanceCentavos,
        status,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, inv.id));
  }
}

async function addSubscriberCredit(
  tx: Tx,
  subscriberId: string,
  amountCentavos: bigint,
): Promise<void> {
  if (amountCentavos <= 0n) return;
  const [row] = await tx
    .select()
    .from(subscriberCredits)
    .where(eq(subscriberCredits.subscriberId, subscriberId))
    .limit(1)
    .for("update");
  if (row) {
    await tx
      .update(subscriberCredits)
      .set({
        unappliedCentavos: row.unappliedCentavos + amountCentavos,
        updatedAt: new Date(),
      })
      .where(eq(subscriberCredits.subscriberId, subscriberId));
  } else {
    await tx.insert(subscriberCredits).values({
      subscriberId,
      unappliedCentavos: amountCentavos,
    });
  }
}

async function reduceSubscriberCredit(
  tx: Tx,
  subscriberId: string,
  amountCentavos: bigint,
): Promise<void> {
  if (amountCentavos <= 0n) return;
  const [row] = await tx
    .select()
    .from(subscriberCredits)
    .where(eq(subscriberCredits.subscriberId, subscriberId))
    .limit(1)
    .for("update");
  const current = row?.unappliedCentavos ?? 0n;
  if (current < amountCentavos) {
    throw new AppError(
      409,
      "CONFLICT",
      "Cannot reverse payment: subscriber credit was already applied.",
    );
  }
  await tx
    .update(subscriberCredits)
    .set({
      unappliedCentavos: current - amountCentavos,
      updatedAt: new Date(),
    })
    .where(eq(subscriberCredits.subscriberId, subscriberId));
}

async function getPaymentByIdempotency(
  db: Database["db"] | Tx,
  key: string,
) {
  const [row] = await db
    .select()
    .from(payments)
    .where(eq(payments.idempotencyKey, key))
    .limit(1);
  return row ?? null;
}

export async function previewPaymentAllocation(
  db: Database["db"],
  input: {
    subscriberId: string;
    amountCentavos: bigint;
    manual?: ManualAllocationInput[];
  },
) {
  const [sub] = await db
    .select({ id: subscribers.id })
    .from(subscribers)
    .where(eq(subscribers.id, input.subscriberId))
    .limit(1);
  if (!sub) throw new AppError(404, "NOT_FOUND", "Subscriber not found.");

  const openRows = await loadOpenInvoices(db, input.subscriberId, false);
  const openBalanceCentavos = openRows.reduce(
    (sum, inv) => sum + inv.balanceCentavos,
    0n,
  );
  const allocation = runAllocation(
    input.amountCentavos,
    toAllocatable(openRows),
    input.manual,
  );

  return {
    allocations: allocation.allocations.map((a) => ({
      invoiceId: a.invoiceId,
      invoiceNumber: a.invoiceNumber,
      allocatedCentavos: centavosToString(a.allocatedCentavos),
      previousBalanceCentavos: centavosToString(a.previousBalanceCentavos),
      remainingBalanceCentavos: centavosToString(a.remainingBalanceCentavos),
      resultingStatus: a.resultingStatus,
    })),
    totalAllocatedCentavos: centavosToString(allocation.totalAllocatedCentavos),
    unallocatedCentavos: centavosToString(allocation.unallocatedCentavos),
    openBalanceCentavos: centavosToString(openBalanceCentavos),
  };
}

async function buildReceiptDetail(db: Database["db"] | Tx, receiptId: string) {
  const [row] = await db
    .select({
      receipt: receipts,
      payment: payments,
      subscriber: subscribers,
      issuedByName: users.fullName,
    })
    .from(receipts)
    .innerJoin(payments, eq(receipts.paymentId, payments.id))
    .innerJoin(subscribers, eq(receipts.subscriberId, subscribers.id))
    .leftJoin(users, eq(receipts.issuedBy, users.id))
    .where(eq(receipts.id, receiptId))
    .limit(1);

  if (!row) throw new AppError(404, "NOT_FOUND", "Receipt not found.");

  const allocs = await db
    .select({
      amountCentavos: paymentAllocations.amountCentavos,
      invoiceNumber: invoices.invoiceNumber,
      billingPeriod: invoices.billingPeriod,
    })
    .from(paymentAllocations)
    .innerJoin(invoices, eq(paymentAllocations.invoiceId, invoices.id))
    .where(eq(paymentAllocations.paymentId, row.payment.id));

  return {
    id: row.receipt.id,
    receiptNumber: row.receipt.receiptNumber,
    status: row.receipt.status,
    amountCentavos: centavosToString(row.receipt.amountCentavos),
    issuedAt: row.receipt.issuedAt.toISOString(),
    voidedAt: row.receipt.voidedAt?.toISOString() ?? null,
    voidReason: row.receipt.voidReason,
    paymentId: row.payment.id,
    paymentMethod: row.payment.method,
    referenceNumber: row.payment.referenceNumber,
    subscriberId: row.subscriber.id,
    subscriberName: row.subscriber.fullName,
    subscriberAccountNumber: row.subscriber.accountNumber,
    subscriberAddress: row.subscriber.address,
    issuedByName: row.issuedByName,
    allocations: allocs.map((a) => ({
      invoiceNumber: a.invoiceNumber,
      billingPeriod: a.billingPeriod,
      amountCentavos: centavosToString(a.amountCentavos),
    })),
    unallocatedCentavos: centavosToString(row.payment.unallocatedCentavos),
    remainingBalanceCentavos: centavosToString(
      await getSubscriberOpenBalance(db as Database["db"], row.subscriber.id),
    ),
  };
}

export async function getReceipt(db: Database["db"], receiptId: string) {
  return buildReceiptDetail(db, receiptId);
}

export async function getReceiptByPayment(
  db: Database["db"],
  paymentId: string,
) {
  const [row] = await db
    .select()
    .from(receipts)
    .where(eq(receipts.paymentId, paymentId))
    .limit(1);
  if (!row) throw new AppError(404, "NOT_FOUND", "Receipt not found.");
  return buildReceiptDetail(db, row.id);
}

async function buildPaymentDetail(db: Database["db"] | Tx, paymentId: string) {
  const actorUsers = aliasedTable(users, "actor_users");
  const verifierUsers = aliasedTable(users, "verifier_users");

  const [row] = await db
    .select({
      payment: payments,
      subscriberName: subscribers.fullName,
      subscriberAccountNumber: subscribers.accountNumber,
      actorName: actorUsers.fullName,
      verifiedByName: verifierUsers.fullName,
      receiptId: receipts.id,
      receiptNumber: receipts.receiptNumber,
      receiptStatus: receipts.status,
    })
    .from(payments)
    .innerJoin(subscribers, eq(payments.subscriberId, subscribers.id))
    .leftJoin(actorUsers, eq(payments.actorUserId, actorUsers.id))
    .leftJoin(verifierUsers, eq(payments.verifiedBy, verifierUsers.id))
    .leftJoin(receipts, eq(receipts.paymentId, payments.id))
    .where(eq(payments.id, paymentId))
    .limit(1);

  if (!row) throw new AppError(404, "NOT_FOUND", "Payment not found.");

  const allocs = await db
    .select({
      id: paymentAllocations.id,
      invoiceId: paymentAllocations.invoiceId,
      amountCentavos: paymentAllocations.amountCentavos,
      invoiceNumber: invoices.invoiceNumber,
    })
    .from(paymentAllocations)
    .innerJoin(invoices, eq(paymentAllocations.invoiceId, invoices.id))
    .where(eq(paymentAllocations.paymentId, paymentId));

  const proofs = await db
    .select()
    .from(paymentProofs)
    .where(eq(paymentProofs.paymentId, paymentId));

  const [reversal] = await db
    .select({
      id: paymentReversals.id,
      reason: paymentReversals.reason,
      createdAt: paymentReversals.createdAt,
      actorName: users.fullName,
    })
    .from(paymentReversals)
    .leftJoin(users, eq(paymentReversals.actorUserId, users.id))
    .where(eq(paymentReversals.originalPaymentId, paymentId))
    .limit(1);

  return {
    id: row.payment.id,
    subscriberId: row.payment.subscriberId,
    subscriberName: row.subscriberName,
    subscriberAccountNumber: row.subscriberAccountNumber,
    method: row.payment.method,
    amountCentavos: centavosToString(row.payment.amountCentavos),
    unallocatedCentavos: centavosToString(row.payment.unallocatedCentavos),
    receivedAt: row.payment.receivedAt.toISOString(),
    referenceNumber: row.payment.referenceNumber,
    senderName: row.payment.senderName,
    status: row.payment.status,
    receiptId: row.receiptId,
    receiptNumber: row.receiptNumber,
    receiptStatus: row.receiptStatus,
    actorName: row.actorName,
    verifiedByName: row.verifiedByName,
    verifiedAt: row.payment.verifiedAt?.toISOString() ?? null,
    notes: row.payment.notes,
    rejectionReason: row.payment.rejectionReason,
    createdAt: row.payment.createdAt.toISOString(),
    allocations: allocs.map((a) => ({
      id: a.id,
      invoiceId: a.invoiceId,
      invoiceNumber: a.invoiceNumber,
      amountCentavos: centavosToString(a.amountCentavos),
    })),
    proofs: proofs.map((p) => ({
      id: p.id,
      originalFilename: p.originalFilename,
      mimeType: p.mimeType,
      sizeBytes: p.sizeBytes,
      createdAt: p.createdAt.toISOString(),
    })),
    reversal: reversal
      ? {
          id: reversal.id,
          reason: reversal.reason,
          actorName: reversal.actorName,
          createdAt: reversal.createdAt.toISOString(),
        }
      : null,
  };
}

export async function getPayment(db: Database["db"], paymentId: string) {
  return buildPaymentDetail(db, paymentId);
}

export async function listPayments(
  db: Database["db"],
  query: {
    page: number;
    pageSize: number;
    subscriberId?: string;
    method?: PaymentMethod;
    status?: (typeof payments.$inferSelect)["status"];
    search?: string;
    fromDate?: string;
    toDate?: string;
  },
) {
  const conditions = [];
  if (query.subscriberId) {
    conditions.push(eq(payments.subscriberId, query.subscriberId));
  }
  if (query.method) conditions.push(eq(payments.method, query.method));
  if (query.status) conditions.push(eq(payments.status, query.status));
  if (query.fromDate) {
    conditions.push(gte(payments.receivedAt, new Date(`${query.fromDate}T00:00:00.000Z`)));
  }
  if (query.toDate) {
    conditions.push(lte(payments.receivedAt, new Date(`${query.toDate}T23:59:59.999Z`)));
  }
  if (query.search) {
    const term = `%${query.search}%`;
    conditions.push(
      or(
        ilike(subscribers.fullName, term),
        ilike(subscribers.accountNumber, term),
        ilike(payments.referenceNumber, term),
        ilike(receipts.receiptNumber, term),
      )!,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const offset = (query.page - 1) * query.pageSize;

  const actorUsers = aliasedTable(users, "list_actor_users");
  const verifierUsers = aliasedTable(users, "list_verifier_users");

  const [totalRow] = await db
    .select({ value: count() })
    .from(payments)
    .innerJoin(subscribers, eq(payments.subscriberId, subscribers.id))
    .leftJoin(receipts, eq(receipts.paymentId, payments.id))
    .where(where);

  const rows = await db
    .select({
      payment: payments,
      subscriberName: subscribers.fullName,
      subscriberAccountNumber: subscribers.accountNumber,
      actorName: actorUsers.fullName,
      verifiedByName: verifierUsers.fullName,
      receiptId: receipts.id,
      receiptNumber: receipts.receiptNumber,
      receiptStatus: receipts.status,
    })
    .from(payments)
    .innerJoin(subscribers, eq(payments.subscriberId, subscribers.id))
    .leftJoin(actorUsers, eq(payments.actorUserId, actorUsers.id))
    .leftJoin(verifierUsers, eq(payments.verifiedBy, verifierUsers.id))
    .leftJoin(receipts, eq(receipts.paymentId, payments.id))
    .where(where)
    .orderBy(desc(payments.receivedAt), desc(payments.createdAt))
    .limit(query.pageSize)
    .offset(offset);

  return {
    items: rows.map((row) => ({
      id: row.payment.id,
      subscriberId: row.payment.subscriberId,
      subscriberName: row.subscriberName,
      subscriberAccountNumber: row.subscriberAccountNumber,
      method: row.payment.method,
      amountCentavos: centavosToString(row.payment.amountCentavos),
      unallocatedCentavos: centavosToString(row.payment.unallocatedCentavos),
      receivedAt: row.payment.receivedAt.toISOString(),
      referenceNumber: row.payment.referenceNumber,
      senderName: row.payment.senderName,
      status: row.payment.status,
      receiptId: row.receiptId,
      receiptNumber: row.receiptNumber,
      receiptStatus: row.receiptStatus,
      actorName: row.actorName,
      verifiedByName: row.verifiedByName,
      verifiedAt: row.payment.verifiedAt?.toISOString() ?? null,
      notes: row.payment.notes,
      createdAt: row.payment.createdAt.toISOString(),
    })),
    page: query.page,
    pageSize: query.pageSize,
    total: Number(totalRow?.value ?? 0),
  };
}

export async function listPendingGCash(
  db: Database["db"],
  query: { page: number; pageSize: number },
) {
  return listPayments(db, {
    ...query,
    method: "GCash",
    status: "PENDING",
  });
}

type PostCoreInput = {
  subscriberId: string;
  amountCentavos: bigint;
  method: PaymentMethod;
  receivedAt: Date;
  referenceNumber?: string | null;
  senderName?: string | null;
  notes?: string | null;
  idempotencyKey: string;
  actorUserId: string;
  manual?: ManualAllocationInput[];
  allowManual: boolean;
  /** Existing PENDING payment row to convert (GCash verify). */
  existingPaymentId?: string;
  verifiedBy?: string;
  verifiedAt?: Date;
  finalStatus: "POSTED" | "VERIFIED";
};

async function postPaymentInTransaction(
  tx: Tx,
  input: PostCoreInput,
): Promise<{ paymentId: string; receiptId: string }> {
  const existing = await getPaymentByIdempotency(tx, input.idempotencyKey);
  if (existing && existing.id !== input.existingPaymentId) {
    throw new AppError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "A payment with this idempotency key already exists.",
    );
  }

  const [sub] = await tx
    .select()
    .from(subscribers)
    .where(eq(subscribers.id, input.subscriberId))
    .limit(1)
    .for("update");
  if (!sub) throw new AppError(404, "NOT_FOUND", "Subscriber not found.");

  if (input.manual && input.manual.length > 0 && !input.allowManual) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Manual allocation requires payment.allocate_manual permission.",
    );
  }

  const openRows = await loadOpenInvoices(tx, input.subscriberId, true);
  const allocation = runAllocation(
    input.amountCentavos,
    toAllocatable(openRows),
    input.manual,
  );
  const graceDays = await getGraceDays(tx);

  let paymentId = input.existingPaymentId;
  if (paymentId) {
    const [pending] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .limit(1)
      .for("update");
    if (!pending || pending.status !== "PENDING") {
      throw new AppError(409, "CONFLICT", "Payment is not pending verification.");
    }
    await tx
      .update(payments)
      .set({
        status: input.finalStatus,
        unallocatedCentavos: allocation.unallocatedCentavos,
        verifiedBy: input.verifiedBy ?? null,
        verifiedAt: input.verifiedAt ?? null,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, paymentId));
  } else {
    const [created] = await tx
      .insert(payments)
      .values({
        subscriberId: input.subscriberId,
        method: input.method,
        amountCentavos: input.amountCentavos,
        unallocatedCentavos: allocation.unallocatedCentavos,
        receivedAt: input.receivedAt,
        referenceNumber: input.referenceNumber ?? null,
        senderName: input.senderName ?? null,
        status: input.finalStatus,
        idempotencyKey: input.idempotencyKey,
        notes: input.notes ?? null,
        actorUserId: input.actorUserId,
        verifiedBy: input.verifiedBy ?? null,
        verifiedAt: input.verifiedAt ?? null,
      })
      .returning();
    paymentId = created!.id;
  }

  if (allocation.allocations.length > 0) {
    await tx.insert(paymentAllocations).values(
      allocation.allocations.map((a) => ({
        paymentId: paymentId!,
        invoiceId: a.invoiceId,
        amountCentavos: a.allocatedCentavos,
      })),
    );
  }

  await applyAllocationToInvoices(tx, allocation, openRows, graceDays);
  await addSubscriberCredit(tx, input.subscriberId, allocation.unallocatedCentavos);

  const receiptNumber = await nextAccountNumber(tx, "RCPT");
  const [receipt] = await tx
    .insert(receipts)
    .values({
      receiptNumber,
      paymentId: paymentId!,
      subscriberId: input.subscriberId,
      status: "ISSUED",
      amountCentavos: input.amountCentavos,
      issuedBy: input.actorUserId,
    })
    .returning();

  const date = entryDateFrom(input.receivedAt);
  await tx.insert(ledgerEntries).values({
    subscriberId: input.subscriberId,
    serviceAccountId: null,
    entryDate: date,
    referenceType: "PAYMENT",
    referenceId: paymentId!,
    description: `${receiptNumber} — ${input.method} payment`,
    debitCentavos: 0n,
    creditCentavos: input.amountCentavos,
  });

  await writeAuditLog(tx, {
    actorUserId: input.actorUserId,
    action: "payment.post",
    entityType: "payment",
    entityId: paymentId!,
    newValues: {
      amountCentavos: centavosToString(input.amountCentavos),
      method: input.method,
      status: input.finalStatus,
      receiptNumber,
      unallocatedCentavos: centavosToString(allocation.unallocatedCentavos),
      allocationCount: allocation.allocations.length,
    },
  });

  return { paymentId: paymentId!, receiptId: receipt!.id };
}

export async function postPayment(
  db: Database["db"],
  actorUserId: string,
  input: {
    subscriberId: string;
    amountCentavos: bigint;
    method: PaymentMethod;
    receivedAt?: Date;
    referenceNumber?: string;
    notes?: string;
    idempotencyKey: string;
    manual?: ManualAllocationInput[];
    allowManual: boolean;
  },
) {
  if (input.method === "GCash") {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "GCash payments must be recorded as pending proofs, then verified.",
    );
  }
  if (input.amountCentavos <= 0n) {
    throw new AppError(400, "VALIDATION_ERROR", "Payment amount must be greater than zero.");
  }

  const existing = await getPaymentByIdempotency(db, input.idempotencyKey);
  if (existing) {
    const payment = await buildPaymentDetail(db, existing.id);
    let receipt = null;
    try {
      receipt = await getReceiptByPayment(db, existing.id);
    } catch {
      receipt = null;
    }
    return { payment, receipt, replayed: true as const };
  }

  const result = await db.transaction(async (tx) =>
    postPaymentInTransaction(tx, {
      subscriberId: input.subscriberId,
      amountCentavos: input.amountCentavos,
      method: input.method,
      receivedAt: input.receivedAt ?? new Date(),
      referenceNumber: input.referenceNumber,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      actorUserId,
      manual: input.manual,
      allowManual: input.allowManual,
      finalStatus: "POSTED",
    }),
  );

  const payment = await buildPaymentDetail(db, result.paymentId);
  const receipt = await buildReceiptDetail(db, result.receiptId);
  return { payment, receipt, replayed: false as const };
}

export async function recordGCashPending(
  db: Database["db"],
  actorUserId: string,
  input: {
    subscriberId: string;
    amountCentavos: bigint;
    referenceNumber: string;
    senderName: string;
    notes?: string;
    idempotencyKey: string;
    proof: {
      originalFilename: string;
      storedFilename: string;
      storagePath: string;
      mimeType: string;
      sizeBytes: number;
    };
  },
) {
  if (input.amountCentavos <= 0n) {
    throw new AppError(400, "VALIDATION_ERROR", "Payment amount must be greater than zero.");
  }

  const existing = await getPaymentByIdempotency(db, input.idempotencyKey);
  if (existing) {
    return { payment: await buildPaymentDetail(db, existing.id), replayed: true as const };
  }

  try {
    const paymentId = await db.transaction(async (tx) => {
      const [sub] = await tx
        .select({ id: subscribers.id })
        .from(subscribers)
        .where(eq(subscribers.id, input.subscriberId))
        .limit(1);
      if (!sub) throw new AppError(404, "NOT_FOUND", "Subscriber not found.");

      const [created] = await tx
        .insert(payments)
        .values({
          subscriberId: input.subscriberId,
          method: "GCash",
          amountCentavos: input.amountCentavos,
          unallocatedCentavos: 0n,
          receivedAt: new Date(),
          referenceNumber: input.referenceNumber,
          senderName: input.senderName,
          status: "PENDING",
          idempotencyKey: input.idempotencyKey,
          notes: input.notes ?? null,
          actorUserId,
        })
        .returning();

      await tx.insert(paymentProofs).values({
        paymentId: created!.id,
        originalFilename: input.proof.originalFilename,
        storedFilename: input.proof.storedFilename,
        storagePath: input.proof.storagePath,
        mimeType: input.proof.mimeType,
        sizeBytes: input.proof.sizeBytes,
        uploadedBy: actorUserId,
      });

      await writeAuditLog(tx, {
        actorUserId,
        action: "payment.gcash.record",
        entityType: "payment",
        entityId: created!.id,
        newValues: {
          status: "PENDING",
          referenceNumber: input.referenceNumber,
          amountCentavos: centavosToString(input.amountCentavos),
        },
      });

      return created!.id;
    });

    return {
      payment: await buildPaymentDetail(db, paymentId),
      replayed: false as const,
    };
  } catch (err) {
    if (isUniqueViolation(err, "payments_gcash_ref_active_idx")) {
      throw new AppError(
        409,
        "DUPLICATE_GCASH_REF",
        "This GCash reference is already pending or verified.",
      );
    }
    throw err;
  }
}

function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const chain: unknown[] = [err];
  let current: unknown = err;
  for (let i = 0; i < 4; i++) {
    if (current && typeof current === "object" && "cause" in current) {
      current = (current as { cause: unknown }).cause;
      chain.push(current);
    } else {
      break;
    }
  }
  return chain.some((e) => {
    if (!e || typeof e !== "object") return false;
    const code = (e as { code?: string }).code;
    const message = (e as { message?: string }).message ?? "";
    const constraintName = (e as { constraint_name?: string; constraint?: string })
      .constraint_name
      ?? (e as { constraint?: string }).constraint
      ?? "";
    if (code !== "23505" && !/duplicate key/i.test(message)) return false;
    if (!constraint) return true;
    return (
      constraintName.includes(constraint) || message.includes(constraint)
    );
  });
}

export async function verifyGCashPayment(
  db: Database["db"],
  actorUserId: string,
  paymentId: string,
  allowManual: boolean,
  manual?: ManualAllocationInput[],
) {
  const [pending] = await db
    .select()
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1);
  if (!pending) throw new AppError(404, "NOT_FOUND", "Payment not found.");
  if (pending.method !== "GCash") {
    throw new AppError(400, "VALIDATION_ERROR", "Only GCash payments can be verified.");
  }
  if (pending.status !== "PENDING") {
    throw new AppError(409, "CONFLICT", "Only PENDING GCash payments can be verified.");
  }

  const result = await db.transaction(async (tx) =>
    postPaymentInTransaction(tx, {
      subscriberId: pending.subscriberId,
      amountCentavos: pending.amountCentavos,
      method: "GCash",
      receivedAt: pending.receivedAt,
      referenceNumber: pending.referenceNumber,
      senderName: pending.senderName,
      notes: pending.notes,
      idempotencyKey: pending.idempotencyKey,
      actorUserId: pending.actorUserId ?? actorUserId,
      manual,
      allowManual,
      existingPaymentId: pending.id,
      verifiedBy: actorUserId,
      verifiedAt: new Date(),
      finalStatus: "VERIFIED",
    }),
  );

  await writeAuditLog(db, {
    actorUserId,
    action: "payment.gcash.verify",
    entityType: "payment",
    entityId: result.paymentId,
    newValues: { status: "VERIFIED" },
  });

  const payment = await buildPaymentDetail(db, result.paymentId);
  const receipt = await buildReceiptDetail(db, result.receiptId);
  return { payment, receipt };
}

export async function rejectGCashPayment(
  db: Database["db"],
  actorUserId: string,
  paymentId: string,
  reason: string,
) {
  return db.transaction(async (tx) => {
    const [pending] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .limit(1)
      .for("update");
    if (!pending) throw new AppError(404, "NOT_FOUND", "Payment not found.");
    if (pending.method !== "GCash" || pending.status !== "PENDING") {
      throw new AppError(409, "CONFLICT", "Only PENDING GCash payments can be rejected.");
    }

    await tx
      .update(payments)
      .set({
        status: "REJECTED",
        rejectionReason: reason,
        verifiedBy: actorUserId,
        verifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(payments.id, paymentId));

    await writeAuditLog(tx, {
      actorUserId,
      action: "payment.gcash.reject",
      entityType: "payment",
      entityId: paymentId,
      reason,
      oldValues: { status: "PENDING" },
      newValues: { status: "REJECTED" },
    });

    return buildPaymentDetail(tx, paymentId);
  });
}

export async function reversePayment(
  db: Database["db"],
  actorUserId: string,
  paymentId: string,
  reason: string,
) {
  return db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .limit(1)
      .for("update");

    if (!payment) throw new AppError(404, "NOT_FOUND", "Payment not found.");
    if (payment.status !== "POSTED" && payment.status !== "VERIFIED") {
      throw new AppError(
        409,
        "CONFLICT",
        "Only posted or verified payments can be reversed.",
      );
    }

    const [existingReversal] = await tx
      .select()
      .from(paymentReversals)
      .where(eq(paymentReversals.originalPaymentId, paymentId))
      .limit(1);
    if (existingReversal) {
      throw new AppError(409, "CONFLICT", "Payment is already reversed.");
    }

    const allocs = await tx
      .select()
      .from(paymentAllocations)
      .where(eq(paymentAllocations.paymentId, paymentId));

    const invoiceIds = allocs.map((a) => a.invoiceId);
    const invoiceRows =
      invoiceIds.length > 0
        ? await tx
            .select()
            .from(invoices)
            .where(inArray(invoices.id, invoiceIds))
            .for("update")
        : [];
    const byId = new Map(invoiceRows.map((i) => [i.id, i]));
    const graceDays = await getGraceDays(tx);

    for (const alloc of allocs) {
      const inv = byId.get(alloc.invoiceId);
      if (!inv) continue;
      const paidCentavos = inv.paidCentavos - alloc.amountCentavos;
      if (paidCentavos < 0n) {
        throw new AppError(409, "CONFLICT", "Invoice paid amount inconsistent.");
      }
      const balanceCentavos = inv.totalCentavos - paidCentavos;
      const status = deriveOpenInvoiceStatus(
        inv.totalCentavos,
        paidCentavos,
        inv.dueDate,
        graceDays,
        todayIso(),
      );
      await tx
        .update(invoices)
        .set({
          paidCentavos,
          balanceCentavos,
          status,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, inv.id));
      inv.paidCentavos = paidCentavos;
      inv.balanceCentavos = balanceCentavos;
    }

    await reduceSubscriberCredit(tx, payment.subscriberId, payment.unallocatedCentavos);

    await tx
      .update(payments)
      .set({ status: "REVERSED", updatedAt: new Date() })
      .where(eq(payments.id, paymentId));

    const [receipt] = await tx
      .select()
      .from(receipts)
      .where(eq(receipts.paymentId, paymentId))
      .limit(1)
      .for("update");
    if (receipt && receipt.status === "ISSUED") {
      await tx
        .update(receipts)
        .set({
          status: "VOID",
          voidedAt: new Date(),
          voidReason: reason,
        })
        .where(eq(receipts.id, receipt.id));
    }

    const [reversal] = await tx
      .insert(paymentReversals)
      .values({
        originalPaymentId: paymentId,
        reason,
        actorUserId,
      })
      .returning();

    await tx.insert(ledgerEntries).values({
      subscriberId: payment.subscriberId,
      serviceAccountId: null,
      entryDate: todayIso(),
      referenceType: "PAYMENT_REVERSAL",
      referenceId: reversal!.id,
      description: `Reversal of ${receipt?.receiptNumber ?? paymentId}: ${reason}`,
      debitCentavos: payment.amountCentavos,
      creditCentavos: 0n,
    });

    await writeAuditLog(tx, {
      actorUserId,
      action: "payment.reverse",
      entityType: "payment",
      entityId: paymentId,
      reason,
      oldValues: { status: payment.status },
      newValues: {
        status: "REVERSED",
        reversalId: reversal!.id,
        receiptStatus: "VOID",
      },
    });

    return buildPaymentDetail(tx, paymentId);
  });
}

export async function getProofPath(
  db: Database["db"],
  proofId: string,
): Promise<{ storagePath: string; mimeType: string; originalFilename: string }> {
  const [proof] = await db
    .select()
    .from(paymentProofs)
    .where(eq(paymentProofs.id, proofId))
    .limit(1);
  if (!proof) throw new AppError(404, "NOT_FOUND", "Proof not found.");
  return {
    storagePath: proof.storagePath,
    mimeType: proof.mimeType,
    originalFilename: proof.originalFilename,
  };
}

export async function getSubscriberOpenBalance(
  db: Database["db"],
  subscriberId: string,
): Promise<bigint> {
  const rows = await loadOpenInvoices(db, subscriberId, false);
  return rows.reduce((sum, inv) => sum + inv.balanceCentavos, 0n);
}
