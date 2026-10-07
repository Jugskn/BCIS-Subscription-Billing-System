import type { FastifyPluginAsync } from "fastify";
import { arAgingReportQuerySchema } from "@bcis/shared";
import { validationError } from "../lib/errors.js";
import { getArAgingSummary, getReceivableTotals } from "../services/receivables-service.js";
import { centavosToString } from "@bcis/shared";

const receivablesRoutes: FastifyPluginAsync = async (app) => {
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
};

export default receivablesRoutes;
