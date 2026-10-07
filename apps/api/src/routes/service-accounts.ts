import type { FastifyPluginAsync } from "fastify";
import {
  createServiceAccountSchema,
  serviceAccountListQuerySchema,
  updateServiceAccountSchema,
} from "@bcis/shared";
import { validationError } from "../lib/errors.js";
import {
  createServiceAccount,
  getServiceAccount,
  listServiceAccounts,
  listServiceEvents,
  updateServiceAccount,
} from "../services/service-account-service.js";

const serviceAccountRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/service-accounts",
    { preHandler: [app.requirePermission("subscriber.view")] },
    async (request) => {
      const parsed = serviceAccountListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid list query.", parsed.error);
      }
      return listServiceAccounts(app.db, parsed.data);
    },
  );

  app.get(
    "/service-accounts/:id",
    { preHandler: [app.requirePermission("subscriber.view")] },
    async (request) => {
      const { id } = request.params as { id: string };
      return getServiceAccount(app.db, id);
    },
  );

  app.get(
    "/service-accounts/:id/events",
    { preHandler: [app.requirePermission("subscriber.view")] },
    async (request) => {
      const { id } = request.params as { id: string };
      return listServiceEvents(app.db, id);
    },
  );

  app.post(
    "/service-accounts",
    { preHandler: [app.requirePermission("service.manage")] },
    async (request, reply) => {
      const parsed = createServiceAccountSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationError(
          "Please check the service account details and try again.",
          parsed.error,
        );
      }
      const account = await createServiceAccount(
        app.db,
        request.user.id,
        parsed.data,
      );
      return reply.code(201).send(account);
    },
  );

  app.put(
    "/service-accounts/:id",
    { preHandler: [app.requirePermission("service.manage")] },
    async (request) => {
      const { id } = request.params as { id: string };
      const parsed = updateServiceAccountSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationError("Invalid update payload.", parsed.error);
      }
      return updateServiceAccount(app.db, request.user.id, id, parsed.data);
    },
  );
};

export default serviceAccountRoutes;
