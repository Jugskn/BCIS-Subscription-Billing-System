import type { FastifyPluginAsync } from "fastify";
import {
  createServicePlanSchema,
  optionsSearchQuerySchema,
  servicePlanListQuerySchema,
  updateServicePlanSchema,
} from "@bcis/shared";
import { validationError } from "../lib/errors.js";
import { listPlanOptions } from "../services/options-service.js";
import {
  createServicePlan,
  listServicePlans,
  listServiceTypes,
  updateServicePlan,
} from "../services/service-plan-service.js";

const servicePlanRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/service-types",
    { preHandler: [app.requirePermission("service.manage")] },
    async () => listServiceTypes(app.db),
  );

  app.get(
    "/plans/options",
    { preHandler: [app.requirePermission("service.manage")] },
    async (request) => {
      const parsed = optionsSearchQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid options query.", parsed.error);
      }
      return listPlanOptions(app.db, parsed.data.search);
    },
  );

  app.get(
    "/service-plans",
    { preHandler: [app.requirePermission("service.manage")] },
    async (request) => {
      const parsed = servicePlanListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid list query.", parsed.error);
      }
      return listServicePlans(app.db, parsed.data);
    },
  );

  app.post(
    "/service-plans",
    { preHandler: [app.requirePermission("service.manage")] },
    async (request, reply) => {
      const parsed = createServicePlanSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationError(
          "Please check the plan details and try again.",
          parsed.error,
        );
      }
      const plan = await createServicePlan(
        app.db,
        request.user.id,
        parsed.data,
      );
      return reply.code(201).send(plan);
    },
  );

  app.put(
    "/service-plans/:id",
    { preHandler: [app.requirePermission("service.manage")] },
    async (request) => {
      const { id } = request.params as { id: string };
      const parsed = updateServicePlanSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationError("Invalid update payload.", parsed.error);
      }
      return updateServicePlan(app.db, request.user.id, id, parsed.data);
    },
  );
};

export default servicePlanRoutes;
