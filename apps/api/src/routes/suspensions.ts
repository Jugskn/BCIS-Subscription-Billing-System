import type { FastifyPluginAsync } from "fastify";
import {
  completeReconnectionSchema,
  createReconnectionSchema,
  createSuspensionSchema,
} from "@bcis/shared";
import { validationError } from "../lib/errors.js";
import {
  completeReconnection,
  createReconnection,
  createSuspension,
  listSuspensionsForAccount,
} from "../services/suspension-service.js";

const suspensionRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/suspensions",
    { preHandler: [app.requirePermission("service.manage")] },
    async (request, reply) => {
      const parsed = createSuspensionSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationError("Invalid suspension payload.", parsed.error);
      }
      const row = await createSuspension(app.db, request.user.id, parsed.data);
      return reply.code(201).send(row);
    },
  );

  app.get(
    "/service-accounts/:id/suspensions",
    { preHandler: [app.requirePermission("subscriber.view")] },
    async (request) => {
      const { id } = request.params as { id: string };
      return listSuspensionsForAccount(app.db, id);
    },
  );

  app.post(
    "/reconnections",
    { preHandler: [app.requirePermission("service.manage")] },
    async (request, reply) => {
      const parsed = createReconnectionSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationError("Invalid reconnection payload.", parsed.error);
      }
      const row = await createReconnection(
        app.db,
        request.user.id,
        parsed.data,
      );
      return reply.code(201).send(row);
    },
  );

  app.post(
    "/reconnections/:id/complete",
    { preHandler: [app.requirePermission("service.manage")] },
    async (request) => {
      const { id } = request.params as { id: string };
      const parsed = completeReconnectionSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        throw validationError("Invalid completion payload.", parsed.error);
      }
      return completeReconnection(
        app.db,
        request.user.id,
        id,
        parsed.data.notes,
      );
    },
  );
};

export default suspensionRoutes;
