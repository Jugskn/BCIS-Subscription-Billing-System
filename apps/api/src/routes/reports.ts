import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  arAgingReportQuerySchema,
  auditReportQuerySchema,
  billingVsCollectionQuerySchema,
  collectionsReportQuerySchema,
  collectorReportQuerySchema,
  exportFormatSchema,
  ledgerReportQuerySchema,
  paymentMethodReportQuerySchema,
  reversalsReportQuerySchema,
  revenueReportQuerySchema,
  routeSheetQuerySchema,
  subscriberMasterQuerySchema,
  type ExportFormat,
} from "@bcis/shared";
import { validationError } from "../lib/errors.js";
import {
  exportReport,
  type ReportColumn,
  type ReportExportInput,
} from "../lib/export.js";
import * as reports from "../services/reports-service.js";

function generatedBy(request: FastifyRequest): string {
  return request.user?.fullName || request.user?.username || "Unknown";
}

function parseFormat(query: unknown): ExportFormat {
  const raw =
    typeof query === "object" && query && "format" in query
      ? (query as { format?: unknown }).format
      : "xlsx";
  const parsed = exportFormatSchema.safeParse(raw ?? "xlsx");
  if (!parsed.success) {
    throw validationError("Invalid export format.", parsed.error);
  }
  return parsed.data;
}

async function sendExport(
  reply: FastifyReply,
  format: ExportFormat,
  input: ReportExportInput,
) {
  const result = await exportReport(format, input);
  reply
    .header("Content-Type", result.contentType)
    .header(
      "Content-Disposition",
      `attachment; filename="${result.filename}"`,
    )
    .send(result.buffer);
}

function stripMeta<T extends { allRows?: unknown; statement?: unknown }>(
  data: T,
): Omit<T, "allRows"> {
  const { allRows: _all, ...rest } = data;
  return rest;
}

const reportsRoutes: FastifyPluginAsync = async (app) => {
  // --- Collections ---
  app.get(
    "/reports/collections",
    { preHandler: [app.requirePermission("report.view")] },
    async (request) => {
      const parsed = collectionsReportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid collections report query.", parsed.error);
      }
      return stripMeta(await reports.collectionsReport(app.db, parsed.data));
    },
  );

  app.get(
    "/reports/collections/export",
    { preHandler: [app.requirePermission("report.export")] },
    async (request, reply) => {
      const parsed = collectionsReportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid collections report query.", parsed.error);
      }
      const format = parseFormat(request.query);
      const data = await reports.collectionsReport(app.db, {
        ...parsed.data,
        page: 1,
        pageSize: 100,
      });
      const columns: ReportColumn[] = [
        { key: "receivedAt", header: "Received at" },
        { key: "accountNumber", header: "Account" },
        { key: "subscriberName", header: "Subscriber" },
        { key: "method", header: "Method" },
        { key: "receiptNumber", header: "Receipt" },
        { key: "referenceNumber", header: "Reference" },
        { key: "amountCentavos", header: "Amount", money: true, align: "right" },
        { key: "status", header: "Status" },
      ];
      return sendExport(reply, format, {
        title: "Collection Report",
        generatedBy: generatedBy(request),
        filters: {
          period: parsed.data.period,
          fromDate: data.fromDate,
          toDate: data.toDate,
          method: parsed.data.method,
        },
        columns,
        rows: data.allRows,
        totals: { amountCentavos: data.totals.amountCentavos },
        filenameBase: "collections",
      });
    },
  );

  // --- Payment methods ---
  app.get(
    "/reports/payment-methods",
    { preHandler: [app.requirePermission("report.view")] },
    async (request) => {
      const parsed = paymentMethodReportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid payment method report query.", parsed.error);
      }
      return stripMeta(await reports.paymentMethodReport(app.db, parsed.data));
    },
  );

  app.get(
    "/reports/payment-methods/export",
    { preHandler: [app.requirePermission("report.export")] },
    async (request, reply) => {
      const parsed = paymentMethodReportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid payment method report query.", parsed.error);
      }
      const format = parseFormat(request.query);
      const data = await reports.paymentMethodReport(app.db, {
        ...parsed.data,
        page: 1,
        pageSize: 100,
      });
      return sendExport(reply, format, {
        title: "Payment Method Summary",
        generatedBy: generatedBy(request),
        filters: { fromDate: data.fromDate, toDate: data.toDate },
        columns: [
          { key: "method", header: "Method" },
          { key: "count", header: "Count", align: "right" },
          { key: "amountCentavos", header: "Amount", money: true, align: "right" },
        ],
        rows: data.allRows,
        totals: { amountCentavos: data.totals.amountCentavos, count: data.totals.count },
        filenameBase: "payment-methods",
      });
    },
  );

  // --- Billing vs collection ---
  app.get(
    "/reports/billing-vs-collection",
    { preHandler: [app.requirePermission("report.view")] },
    async (request) => {
      const parsed = billingVsCollectionQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid billing vs collection query.", parsed.error);
      }
      return stripMeta(
        await reports.billingVsCollectionReport(app.db, parsed.data.months),
      );
    },
  );

  app.get(
    "/reports/billing-vs-collection/export",
    { preHandler: [app.requirePermission("report.export")] },
    async (request, reply) => {
      const parsed = billingVsCollectionQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid billing vs collection query.", parsed.error);
      }
      const format = parseFormat(request.query);
      const data = await reports.billingVsCollectionReport(
        app.db,
        parsed.data.months,
      );
      return sendExport(reply, format, {
        title: "Billing vs Collection",
        generatedBy: generatedBy(request),
        filters: { months: String(parsed.data.months) },
        columns: [
          { key: "month", header: "Month" },
          { key: "billedCentavos", header: "Billed", money: true, align: "right" },
          {
            key: "collectedCentavos",
            header: "Collected",
            money: true,
            align: "right",
          },
        ],
        rows: data.allRows,
        totals: {
          billedCentavos: data.totals.billedCentavos,
          collectedCentavos: data.totals.collectedCentavos,
        },
        filenameBase: "billing-vs-collection",
      });
    },
  );

  // --- Revenue ---
  app.get(
    "/reports/revenue",
    { preHandler: [app.requirePermission("report.view")] },
    async (request) => {
      const parsed = revenueReportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid revenue report query.", parsed.error);
      }
      return stripMeta(await reports.revenueReport(app.db, parsed.data));
    },
  );

  app.get(
    "/reports/revenue/export",
    { preHandler: [app.requirePermission("report.export")] },
    async (request, reply) => {
      const parsed = revenueReportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid revenue report query.", parsed.error);
      }
      const format = parseFormat(request.query);
      const data = await reports.revenueReport(app.db, {
        ...parsed.data,
        page: 1,
        pageSize: 100,
      });
      return sendExport(reply, format, {
        title: `Revenue by ${parsed.data.groupBy}`,
        generatedBy: generatedBy(request),
        filters: {
          groupBy: parsed.data.groupBy,
          fromDate: data.fromDate,
          toDate: data.toDate,
        },
        columns: [
          { key: "groupCode", header: "Code" },
          { key: "groupName", header: "Name" },
          { key: "invoiceCount", header: "Invoices", align: "right" },
          { key: "amountCentavos", header: "Amount", money: true, align: "right" },
        ],
        rows: data.allRows,
        totals: { amountCentavos: data.totals.amountCentavos },
        filenameBase: `revenue-by-${parsed.data.groupBy}`,
      });
    },
  );

  // --- AR aging ---
  app.get(
    "/reports/ar-aging",
    { preHandler: [app.requirePermission("report.view")] },
    async (request) => {
      const parsed = arAgingReportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid AR aging report query.", parsed.error);
      }
      return stripMeta(await reports.arAgingReport(app.db, parsed.data));
    },
  );

  app.get(
    "/reports/ar-aging/export",
    { preHandler: [app.requirePermission("report.export")] },
    async (request, reply) => {
      const parsed = arAgingReportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid AR aging report query.", parsed.error);
      }
      const format = parseFormat(request.query);
      const data = await reports.arAgingReport(app.db, {
        ...parsed.data,
        page: 1,
        pageSize: 100,
      });
      return sendExport(reply, format, {
        title: "AR Aging",
        generatedBy: generatedBy(request),
        filters: {
          asOfDate: data.summary.asOfDate,
          graceDays: String(data.summary.graceDays),
        },
        columns: [
          { key: "invoiceNumber", header: "Invoice" },
          { key: "accountNumber", header: "Account" },
          { key: "subscriberName", header: "Subscriber" },
          { key: "dueDate", header: "Due date" },
          { key: "daysPastDue", header: "Days past due", align: "right" },
          { key: "bucket", header: "Bucket" },
          { key: "balanceCentavos", header: "Balance", money: true, align: "right" },
        ],
        rows: data.allRows,
        totals: { balanceCentavos: data.totals.balanceCentavos },
        filenameBase: "ar-aging",
      });
    },
  );

  // --- Subscriber master ---
  app.get(
    "/reports/subscribers",
    { preHandler: [app.requirePermission("report.view")] },
    async (request) => {
      const parsed = subscriberMasterQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid subscriber master query.", parsed.error);
      }
      return stripMeta(await reports.subscriberMasterReport(app.db, parsed.data));
    },
  );

  app.get(
    "/reports/subscribers/export",
    { preHandler: [app.requirePermission("report.export")] },
    async (request, reply) => {
      const parsed = subscriberMasterQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid subscriber master query.", parsed.error);
      }
      const format = parseFormat(request.query);
      const data = await reports.subscriberMasterReport(app.db, {
        ...parsed.data,
        page: 1,
        pageSize: 100,
      });
      return sendExport(reply, format, {
        title: "Subscriber Master List",
        generatedBy: generatedBy(request),
        filters: {
          status: parsed.data.status,
          collectionAreaId: parsed.data.collectionAreaId,
        },
        columns: [
          { key: "accountNumber", header: "Account" },
          { key: "fullName", header: "Name" },
          { key: "contactPhone", header: "Phone" },
          { key: "address", header: "Address" },
          { key: "status", header: "Status" },
          { key: "dueDay", header: "Due day", align: "right" },
          { key: "areaName", header: "Area" },
          { key: "collectorName", header: "Collector" },
        ],
        rows: data.allRows,
        filenameBase: "subscriber-master",
      });
    },
  );

  // --- Ledger / SOA ---
  app.get(
    "/reports/ledger",
    { preHandler: [app.requirePermission("report.view")] },
    async (request) => {
      const parsed = ledgerReportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid ledger report query.", parsed.error);
      }
      return stripMeta(await reports.ledgerStatementReport(app.db, parsed.data));
    },
  );

  app.get(
    "/reports/ledger/export",
    { preHandler: [app.requirePermission("report.export")] },
    async (request, reply) => {
      const parsed = ledgerReportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid ledger report query.", parsed.error);
      }
      const format = parseFormat(request.query);
      const data = await reports.ledgerStatementReport(app.db, {
        ...parsed.data,
        page: 1,
        pageSize: 100,
      });
      const soa = data.statement;
      return sendExport(reply, format, {
        title: "Subscriber Ledger / Statement of Account",
        generatedBy: generatedBy(request),
        filters: {
          account: soa.accountNumber,
          subscriber: soa.subscriberName,
          fromDate: soa.fromDate,
          toDate: soa.toDate,
          opening: soa.openingBalanceCentavos,
          closing: soa.closingBalanceCentavos,
        },
        columns: [
          { key: "entryDate", header: "Date" },
          { key: "referenceType", header: "Type" },
          { key: "description", header: "Description" },
          { key: "debitCentavos", header: "Debit", money: true, align: "right" },
          { key: "creditCentavos", header: "Credit", money: true, align: "right" },
          { key: "balanceCentavos", header: "Balance", money: true, align: "right" },
        ],
        rows: data.allRows,
        totals: {
          debitCentavos: "",
          creditCentavos: "",
          balanceCentavos: soa.closingBalanceCentavos,
        },
        filenameBase: "subscriber-ledger",
      });
    },
  );

  // --- Collector ---
  app.get(
    "/reports/collectors",
    { preHandler: [app.requirePermission("report.view")] },
    async (request) => {
      const parsed = collectorReportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid collector report query.", parsed.error);
      }
      return stripMeta(await reports.collectorReport(app.db, parsed.data));
    },
  );

  app.get(
    "/reports/collectors/export",
    { preHandler: [app.requirePermission("report.export")] },
    async (request, reply) => {
      const parsed = collectorReportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid collector report query.", parsed.error);
      }
      const format = parseFormat(request.query);
      const data = await reports.collectorReport(app.db, {
        ...parsed.data,
        page: 1,
        pageSize: 100,
      });
      return sendExport(reply, format, {
        title: "Collector Remittance & Performance",
        generatedBy: generatedBy(request),
        filters: { fromDate: data.fromDate, toDate: data.toDate },
        columns: [
          { key: "collectorName", header: "Collector" },
          { key: "assignedSubscribers", header: "Assigned", align: "right" },
          { key: "paymentCount", header: "Payments", align: "right" },
          {
            key: "collectedCentavos",
            header: "Collected",
            money: true,
            align: "right",
          },
          {
            key: "remittedCentavos",
            header: "Remitted",
            money: true,
            align: "right",
          },
          {
            key: "shortageOverageCentavos",
            header: "Shortage/Overage",
            money: true,
            align: "right",
          },
        ],
        rows: data.allRows,
        totals: {
          collectedCentavos: data.totals.collectedCentavos,
          remittedCentavos: data.totals.remittedCentavos,
          shortageOverageCentavos: data.totals.shortageOverageCentavos,
        },
        filenameBase: "collector-performance",
      });
    },
  );

  // --- Reversals / voids ---
  app.get(
    "/reports/reversals",
    { preHandler: [app.requirePermission("report.view")] },
    async (request) => {
      const parsed = reversalsReportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid reversals report query.", parsed.error);
      }
      return stripMeta(await reports.reversalsReport(app.db, parsed.data));
    },
  );

  app.get(
    "/reports/reversals/export",
    { preHandler: [app.requirePermission("report.export")] },
    async (request, reply) => {
      const parsed = reversalsReportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid reversals report query.", parsed.error);
      }
      const format = parseFormat(request.query);
      const data = await reports.reversalsReport(app.db, {
        ...parsed.data,
        page: 1,
        pageSize: 100,
      });
      return sendExport(reply, format, {
        title: "Payment Reversals and Voided Receipts",
        generatedBy: generatedBy(request),
        filters: { fromDate: data.fromDate, toDate: data.toDate },
        columns: [
          { key: "at", header: "When" },
          { key: "kind", header: "Kind" },
          { key: "accountNumber", header: "Account" },
          { key: "subscriberName", header: "Subscriber" },
          { key: "receiptNumber", header: "Receipt" },
          { key: "method", header: "Method" },
          { key: "amountCentavos", header: "Amount", money: true, align: "right" },
          { key: "reason", header: "Reason" },
          { key: "actorName", header: "Actor" },
        ],
        rows: data.allRows,
        totals: { amountCentavos: data.totals.amountCentavos },
        filenameBase: "reversals-voids",
      });
    },
  );

  // --- Audit (Owner / Auditor via audit.view) ---
  app.get(
    "/reports/audit",
    { preHandler: [app.requirePermission("audit.view")] },
    async (request) => {
      const parsed = auditReportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid audit report query.", parsed.error);
      }
      return stripMeta(await reports.auditReport(app.db, parsed.data));
    },
  );

  app.get(
    "/reports/audit/export",
    {
      preHandler: [
        app.requirePermission("audit.view"),
        app.requirePermission("report.export"),
      ],
    },
    async (request, reply) => {
      const parsed = auditReportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid audit report query.", parsed.error);
      }
      const format = parseFormat(request.query);
      const data = await reports.auditReport(app.db, {
        ...parsed.data,
        page: 1,
        pageSize: 100,
      });
      return sendExport(reply, format, {
        title: "Audit Log and User Activity",
        generatedBy: generatedBy(request),
        filters: {
          fromDate: parsed.data.fromDate,
          toDate: parsed.data.toDate,
          action: parsed.data.action,
        },
        columns: [
          { key: "at", header: "When" },
          { key: "actorName", header: "Actor" },
          { key: "action", header: "Action" },
          { key: "entityType", header: "Entity" },
          { key: "entityId", header: "Entity ID" },
          { key: "reason", header: "Reason" },
        ],
        rows: data.allRows,
        filenameBase: "audit-log",
      });
    },
  );

  // --- Route sheet (print data) ---
  app.get(
    "/reports/route-sheet",
    { preHandler: [app.requirePermission("report.view")] },
    async (request) => {
      const parsed = routeSheetQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid route sheet query.", parsed.error);
      }
      return reports.getRouteSheet(app.db, parsed.data);
    },
  );
};

export default reportsRoutes;
