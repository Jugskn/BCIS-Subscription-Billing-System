import type { FastifyPluginAsync } from "fastify";
import { getDashboard } from "../services/dashboard-service.js";

const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/dashboard",
    { preHandler: [app.requirePermission("receivable.view")] },
    async () => getDashboard(app.db),
  );
};

export default dashboardRoutes;
