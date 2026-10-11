import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  arAgingReportQuerySchema,
  overdueExportQuerySchema,
  overdueListQuerySchema,
  outstandingListQuerySchema,
  paginationQuerySchema,
  suspensionCandidatesQuerySchema,
  suspensionHistoryQuerySchema,
  type ExportFormat,
  centavosToString,
} from "@bcis/shared";
import { validationError } from "../lib/errors.js";
import {
  exportReport,
  type ReportExportInput,
} from "../lib/export.js";
import {
  getArAgingSummary,
  getReceivableTotals,
  listOutstandingReceivables,
  listOverdueReceivables,
  listSuspendedAccounts,
  listSuspensionCandidates,
  listSuspensionHistory,
} from "../services/receivables-service.js";
import { getCompanyProfile } from "../services/settings-service.js";

function generatedBy(request: FastifyRequest): string {
  return request.user?.fullName || request.user?.username || "Unknown";
}

const receivablesRoutes: FastifyPluginAsync = async (app) => {
  async function sendExport(
    reply: FastifyReply,
    format: ExportFormat,
    input: ReportExportInput,
  ) {
    let companyName = input.companyName;
    if (!companyName) {
      try {
        companyName = (await getCompanyProfile(app.db)).companyName;
      } catch {
        companyName = "BCIS";
      }
    }
    const result = await exportReport(format, {
      ...input,
      companyName: companyName || "BCIS",
    });
    reply
      .header("Content-Type", result.contentType)
      .header(
        "Content-Disposition",
        `attachment; filename="${result.filename}"`,
      )
      .send(result.buffer);
  }

  app.get(
    "/receivables/aging",
    { preHandler: [app.requirePermission("receivable.view")] },
    async (request) => {
      const parsed = arAgingReportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid aging query.", parsed.error);
      }
      return getArAgingSummary(app.db, {
        asOfDate: parsed.data.asOfDate,
        collectionAreaId: parsed.data.collectionAreaId,
        collectorUserId: parsed.data.collectorUserId,
      });
    },
  );

  app.get(
    "/receivables/summary",
    { preHandler: [app.requirePermission("receivable.view")] },
    async () => {
      const totals = await getReceivableTotals(app.db);
      return {
        currentReceivableCentavos: centavosToString(
          totals.currentReceivableCentavos,
        ),
        overdueReceivableCentavos: centavosToString(
          totals.overdueReceivableCentavos,
        ),
        subscribersOverdueCount: totals.subscribersOverdueCount,
        totalOpenCentavos: centavosToString(totals.totalOpenCentavos),
      };
    },
  );

  app.get(
    "/receivables/outstanding",
    { preHandler: [app.requirePermission("receivable.view")] },
    async (request) => {
      const parsed = outstandingListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid outstanding query.", parsed.error);
      }
      const { allRows: _all, ...rest } = await listOutstandingReceivables(
        app.db,
        parsed.data,
      );
      return rest;
    },
  );

  app.get(
    "/receivables/overdue",
    { preHandler: [app.requirePermission("receivable.view")] },
    async (request) => {
      const parsed = overdueListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid overdue query.", parsed.error);
      }
      const { allRows: _all, ...rest } = await listOverdueReceivables(
        app.db,
        parsed.data,
      );
      return rest;
    },
  );

  app.get(
    "/receivables/overdue/export",
    { preHandler: [app.requirePermission("report.export")] },
    async (request, reply) => {
      const parsed = overdueExportQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid overdue export query.", parsed.error);
      }
      const { format, ...query } = parsed.data;
      const exportData = await listOverdueReceivables(app.db, {
        ...query,
        page: 1,
        pageSize: 100,
      });
      const all = exportData.allRows ?? exportData.items;

      await sendExport(reply, format, {
        title: "Overdue Receivables",
        generatedBy: generatedBy(request),
        filenameBase: "bcis-overdue",
        filters: {
          collectionAreaId: query.collectionAreaId,
          collectorUserId: query.collectorUserId,
          servicePlanId: query.servicePlanId,
          serviceTypeCode: query.serviceTypeCode,
          delinquencyAgeBucket: query.delinquencyAgeBucket,
        },
        columns: [
          { key: "subscriberName", header: "Subscriber" },
          { key: "serviceName", header: "Service" },
          { key: "collectionAreaName", header: "Area" },
          { key: "collectorName", header: "Collector" },
          { key: "monthsUnpaid", header: "Months unpaid", align: "right" },
          { key: "oldestUnpaidInvoice", header: "Oldest unpaid invoice" },
          { key: "lastPaymentDate", header: "Last payment" },
          {
            key: "totalArrearsCentavos",
            header: "Total arrears",
            align: "right",
            money: true,
          },
        ],
        rows: all.map((r) => ({
          subscriberName: r.subscriberName,
          serviceName: r.serviceName,
          collectionAreaName: r.collectionAreaName ?? "",
          collectorName: r.collectorName ?? "",
          monthsUnpaid: r.monthsUnpaid,
          oldestUnpaidInvoice: r.oldestUnpaidInvoice,
          lastPaymentDate: r.lastPaymentDate ?? "",
          totalArrearsCentavos: r.totalArrearsCentavos,
        })),
        totals: {
          totalArrearsCentavos: exportData.totals.arrearsCentavos,
        },
      });
    },
  );

  app.get(
    "/receivables/suspension-candidates",
    { preHandler: [app.requirePermission("receivable.view")] },
    async (request) => {
      const parsed = suspensionCandidatesQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError(
          "Invalid suspension candidates query.",
          parsed.error,
        );
      }
      return listSuspensionCandidates(app.db, parsed.data);
    },
  );

  app.get(
    "/receivables/suspended",
    { preHandler: [app.requirePermission("receivable.view")] },
    async (request) => {
      const parsed = paginationQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid suspended list query.", parsed.error);
      }
      return listSuspendedAccounts(app.db, parsed.data);
    },
  );

  app.get(
    "/receivables/suspension-history",
    { preHandler: [app.requirePermission("receivable.view")] },
    async (request) => {
      const parsed = suspensionHistoryQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid suspension history query.", parsed.error);
      }
      return listSuspensionHistory(app.db, parsed.data);
    },
  );
};

export default receivablesRoutes;
