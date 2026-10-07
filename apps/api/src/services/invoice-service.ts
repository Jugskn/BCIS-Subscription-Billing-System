import { eq } from "drizzle-orm";
import {
  adjustments,
  invoiceItems,
  invoices,
  ledgerEntries,
  subscriberCredits,
  type Database,
} from "@bcis/db";
import {
  centavosToString,
  computeAdjustmentLedgerOffset,
  computeInvoiceTotals,
  computeVoidLedgerOffset,
  deriveOpenInvoiceStatus,
  type InvoiceLineInput,
} from "@bcis/shared";
import { AppError } from "../lib/errors.js";
import { writeAuditLog } from "../lib/audit.js";
import { getGraceDays } from "./settings-service.js";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function voidInvoice(
  db: Database["db"],
  actorUserId: string,
  invoiceId: string,
  reason: string,
) {
  return db.transaction(async (tx) => {
    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1)
      .for("update");

    if (!invoice) throw new AppError(404, "NOT_FOUND", "Invoice not found.");
    if (invoice.status === "VOID") {
      throw new AppError(409, "CONFLICT", "Invoice is already void.");
    }
    if (invoice.paidCentavos > invoice.creditAppliedCentavos) {
      throw new AppError(
        409,
        "CONFLICT",
        "Cannot void an invoice with posted payments. Reverse payments first.",
      );
    }

    const offset = computeVoidLedgerOffset({
      invoiceNumber: invoice.invoiceNumber,
      balanceCentavos: invoice.balanceCentavos,
      paidCentavos: invoice.paidCentavos,
    });

    const [updated] = await tx
      .update(invoices)
      .set({
        status: "VOID",
        voidReason: reason,
        voidedAt: new Date(),
        voidedBy: actorUserId,
        balanceCentavos: 0n,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoiceId))
      .returning();

    if (offset.creditCentavos > 0n) {
      await tx.insert(ledgerEntries).values({
        subscriberId: invoice.subscriberId,
        serviceAccountId: invoice.serviceAccountId,
        entryDate: todayIso(),
        referenceType: "INVOICE_VOID",
        referenceId: invoice.id,
        description: offset.description,
        debitCentavos: offset.debitCentavos,
        creditCentavos: offset.creditCentavos,
      });
    }

    if (invoice.creditAppliedCentavos > 0n) {
      const [creditRow] = await tx
        .select()
        .from(subscriberCredits)
        .where(eq(subscriberCredits.subscriberId, invoice.subscriberId))
        .limit(1)
        .for("update");

      const restored = (creditRow?.unappliedCentavos ?? 0n) + invoice.creditAppliedCentavos;
      if (creditRow) {
        await tx
          .update(subscriberCredits)
          .set({ unappliedCentavos: restored, updatedAt: new Date() })
          .where(eq(subscriberCredits.subscriberId, invoice.subscriberId));
      } else {
        await tx.insert(subscriberCredits).values({
          subscriberId: invoice.subscriberId,
          unappliedCentavos: restored,
        });
      }
    }

    await writeAuditLog(tx, {
      actorUserId,
      action: "invoice.void",
      entityType: "invoice",
      entityId: invoiceId,
      reason,
      oldValues: {
        status: invoice.status,
        balanceCentavos: centavosToString(invoice.balanceCentavos),
      },
      newValues: { status: "VOID" },
    });

    return updated!;
  });
}

export async function adjustInvoice(
  db: Database["db"],
  actorUserId: string,
  invoiceId: string,
  amountCentavos: bigint,
  reason: string,
) {
  return db.transaction(async (tx) => {
    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1)
      .for("update");

    if (!invoice) throw new AppError(404, "NOT_FOUND", "Invoice not found.");
    if (invoice.status === "VOID") {
      throw new AppError(409, "CONFLICT", "Cannot adjust a void invoice.");
    }
    if (invoice.status === "PAID") {
      throw new AppError(409, "CONFLICT", "Cannot adjust a fully paid invoice.");
    }

    const offset = computeAdjustmentLedgerOffset(
      invoice.invoiceNumber,
      amountCentavos,
      reason,
    );

    const adjustmentType = amountCentavos > 0n ? "DEBIT" : "CREDIT";
    const absAmount = amountCentavos < 0n ? -amountCentavos : amountCentavos;

    const [adj] = await tx
      .insert(adjustments)
      .values({
        invoiceId,
        subscriberId: invoice.subscriberId,
        adjustmentType,
        amountCentavos: absAmount,
        reason,
        actorUserId,
      })
      .returning();

    const itemType = amountCentavos > 0n ? "ADJUSTMENT" : "DISCOUNT";
    const line: InvoiceLineInput = {
      itemType,
      description: reason,
      rateCentavos: absAmount,
      quantity: 1,
      amountCentavos: absAmount,
    };

    await tx.insert(invoiceItems).values({
      invoiceId,
      itemType: line.itemType,
      description: line.description,
      rateCentavos: line.rateCentavos,
      quantity: 1,
      amountCentavos: line.amountCentavos,
    });

    const existingItems = await tx
      .select()
      .from(invoiceItems)
      .where(eq(invoiceItems.invoiceId, invoiceId));

    const totals = computeInvoiceTotals(
      existingItems.map((item) => ({
        itemType: item.itemType,
        description: item.description,
        rateCentavos: item.rateCentavos,
        quantity: item.quantity,
        amountCentavos: item.amountCentavos,
      })),
    );

    const newTotal = totals.totalCentavos;
    const newBalance = newTotal - invoice.paidCentavos;
    if (newBalance < 0n) {
      throw new AppError(400, "VALIDATION_ERROR", "Adjustment would over-credit invoice.");
    }

    const graceDays = await getGraceDays(tx);
    const status = deriveOpenInvoiceStatus(
      newTotal,
      invoice.paidCentavos,
      invoice.dueDate,
      graceDays,
      todayIso(),
    );

    const [updated] = await tx
      .update(invoices)
      .set({
        subtotalCentavos: totals.subtotalCentavos,
        discountCentavos: totals.discountCentavos,
        penaltyCentavos: totals.penaltyCentavos,
        adjustmentCentavos: totals.adjustmentCentavos,
        totalCentavos: newTotal,
        balanceCentavos: newBalance,
        status,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoiceId))
      .returning();

    await tx.insert(ledgerEntries).values({
      subscriberId: invoice.subscriberId,
      serviceAccountId: invoice.serviceAccountId,
      entryDate: todayIso(),
      referenceType: "ADJUSTMENT",
      referenceId: adj!.id,
      description: offset.description,
      debitCentavos: offset.debitCentavos,
      creditCentavos: offset.creditCentavos,
    });

    await writeAuditLog(tx, {
      actorUserId,
      action: "invoice.adjust",
      entityType: "invoice",
      entityId: invoiceId,
      reason,
      oldValues: {
        totalCentavos: centavosToString(invoice.totalCentavos),
        balanceCentavos: centavosToString(invoice.balanceCentavos),
      },
      newValues: {
        totalCentavos: centavosToString(newTotal),
        balanceCentavos: centavosToString(newBalance),
      },
    });

    return updated!;
  });
}
