import type { FastifyPluginAsync } from "fastify";
import {
  adjustInvoiceSchema,
  generateBillingConfirmSchema,
  generateBillingPreviewSchema,
  invoiceListQuerySchema,
  ledgerQuerySchema,
  statementQuerySchema,
  voidInvoiceSchema,
} from "@bcis/shared";
import { AppError } from "../lib/errors.js";
import {
  generateBillingForPeriod,
  getCurrentBillingCycle,
  getInvoice,
  listInvoices,
  previewBillingGeneration,
} from "../services/billing-service.js";
import { adjustInvoice, voidInvoice } from "../services/invoice-service.js";
import {
  getStatementOfAccount,
  listSubscriberLedger,
} from "../services/ledger-service.js";

const billingRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/billing/current",
    { preHandler: [app.requirePermission("billing.generate")] },
    async () => getCurrentBillingCycle(app.db),
  );

  app.post(
    "/billing/preview",
    { preHandler: [app.requirePermission("billing.generate")] },
    async (request) => {
      const parsed = generateBillingPreviewSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Invalid billing period.");
      }
      return previewBillingGeneration(app.db, parsed.data.billingPeriod);
    },
  );

  app.post(
    "/billing/generate",
    { preHandler: [app.requirePermission("billing.generate")] },
    async (request, reply) => {
      const parsed = generateBillingConfirmSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Invalid billing period.");
      }
      const result = await generateBillingForPeriod(
        app.db,
        request.user.id,
        parsed.data.billingPeriod,
      );
      return reply.code(201).send(result);
    },
  );

  app.get(
    "/invoices",
    { preHandler: [app.requirePermission("receivable.view")] },
    async (request) => {
      const parsed = invoiceListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Invalid list query.");
      }
      return listInvoices(app.db, parsed.data);
    },
  );

  app.get(
    "/invoices/:id",
    { preHandler: [app.requirePermission("receivable.view")] },
    async (request) => {
      const { id } = request.params as { id: string };
      return getInvoice(app.db, id);
    },
  );

  app.post(
    "/invoices/:id/void",
    { preHandler: [app.requirePermission("billing.void")] },
    async (request) => {
      const { id } = request.params as { id: string };
      const parsed = voidInvoiceSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Reason is required.");
      }
      await voidInvoice(app.db, request.user.id, id, parsed.data.reason);
      return getInvoice(app.db, id);
    },
  );

  app.post(
    "/invoices/:id/adjust",
    { preHandler: [app.requirePermission("billing.void")] },
    async (request) => {
      const { id } = request.params as { id: string };
      const parsed = adjustInvoiceSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Invalid adjustment.");
      }
      await adjustInvoice(
        app.db,
        request.user.id,
        id,
        parsed.data.amount,
        parsed.data.reason,
      );
      return getInvoice(app.db, id);
    },
  );

  app.get(
    "/subscribers/:id/ledger",
    { preHandler: [app.requirePermission("receivable.view")] },
    async (request) => {
      const { id } = request.params as { id: string };
      const parsed = ledgerQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Invalid ledger query.");
      }
      return listSubscriberLedger(app.db, id, parsed.data);
    },
  );

  app.get(
    "/subscribers/:id/statement",
    { preHandler: [app.requirePermission("receivable.view")] },
    async (request) => {
      const { id } = request.params as { id: string };
      const parsed = statementQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Invalid statement query.");
      }
      return getStatementOfAccount(
        app.db,
        id,
        parsed.data.fromDate,
        parsed.data.toDate,
      );
    },
  );
};

export default billingRoutes;
