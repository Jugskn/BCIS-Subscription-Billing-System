import type { FastifyPluginAsync } from "fastify";
import {
  collectorIdParamsSchema,
  createSubscriberSchema,
  globalSearchQuerySchema,
  optionsSearchQuerySchema,
  paginationQuerySchema,
  subscriberCollectionHistoryQuerySchema,
  subscriberListQuerySchema,
  updateSubscriberSchema,
} from "@bcis/shared";
import { AppError, validationError } from "../lib/errors.js";
import { listSubscriberOptions } from "../services/options-service.js";
import {
  createSubscriber,
  getSubscriber,
  globalSearchSubscribers,
  listSubscribers,
  updateSubscriber,
} from "../services/subscriber-service.js";
import { getSubscriberCollectionHistory } from "../services/collection-batch-service.js";
import {
  listSubscriberAudit,
  listSubscriberDocuments,
} from "../services/subscriber-documents-service.js";

const subscriberRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/subscribers",
    { preHandler: [app.requirePermission("subscriber.view")] },
    async (request) => {
      const parsed = subscriberListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid list query.", parsed.error);
      }
      return listSubscribers(app.db, parsed.data);
    },
  );

  app.get(
    "/subscribers/search",
    { preHandler: [app.requirePermission("subscriber.view")] },
    async (request) => {
      const parsed = globalSearchQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid search query.", parsed.error);
      }
      return globalSearchSubscribers(app.db, parsed.data);
    },
  );

  app.get(
    "/subscribers/options",
    { preHandler: [app.requirePermission("subscriber.view")] },
    async (request) => {
      const parsed = optionsSearchQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid options query.", parsed.error);
      }
      return listSubscriberOptions(app.db, parsed.data.search);
    },
  );

  app.get(
    "/subscribers/:id",
    { preHandler: [app.requirePermission("subscriber.view")] },
    async (request) => {
      const { id } = request.params as { id: string };
      return getSubscriber(app.db, id);
    },
  );

  app.get(
    "/subscribers/:id/collection-history",
    { preHandler: [app.requirePermission("subscriber.view")] },
    async (request) => {
      const params = collectorIdParamsSchema.safeParse(request.params);
      const query = subscriberCollectionHistoryQuerySchema.safeParse(
        request.query,
      );
      if (!params.success) {
        throw validationError("Invalid subscriber identifier.", params.error);
      }
      if (!query.success) {
        throw validationError("Invalid collection history query.", query.error);
      }
      return getSubscriberCollectionHistory(
        app.db,
        params.data.id,
        query.data,
      );
    },
  );

  app.get(
    "/subscribers/:id/documents",
    { preHandler: [app.requirePermission("receivable.view")] },
    async (request) => {
      const { id } = request.params as { id: string };
      const parsed = paginationQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid documents query.", parsed.error);
      }
      return listSubscriberDocuments(app.db, id, parsed.data);
    },
  );

  app.get(
    "/subscribers/:id/audit",
    { preHandler: [app.requirePermission("audit.view")] },
    async (request) => {
      const { id } = request.params as { id: string };
      const parsed = paginationQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid audit query.", parsed.error);
      }
      return listSubscriberAudit(app.db, id, parsed.data);
    },
  );

  app.post(
    "/subscribers",
    { preHandler: [app.requirePermission("subscriber.create")] },
    async (request, reply) => {
      const parsed = createSubscriberSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationError(
          "Please check the subscriber details and try again.",
          parsed.error,
        );
      }
      const subscriber = await createSubscriber(
        app.db,
        request.user.id,
        parsed.data,
      );
      return reply.code(201).send(subscriber);
    },
  );

  app.put(
    "/subscribers/:id",
    { preHandler: [app.requirePermission("subscriber.update")] },
    async (request) => {
      const { id } = request.params as { id: string };
      const parsed = updateSubscriberSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationError("Invalid update payload.", parsed.error);
      }
      if (
        parsed.data.status &&
        ["TERMINATED", "ARCHIVED", "INACTIVE"].includes(parsed.data.status)
      ) {
        // status deactivation paths also allowed with subscriber.update;
        // subscriber.deactivate permission checked below for terminal statuses
      }
      const needsDeactivate =
        parsed.data.status === "TERMINATED" ||
        parsed.data.status === "ARCHIVED";
      if (needsDeactivate && !request.user.permissions.includes("subscriber.deactivate")) {
        throw new AppError(
          403,
          "FORBIDDEN",
          "You do not have permission to deactivate subscribers.",
        );
      }
      return updateSubscriber(app.db, request.user.id, id, parsed.data);
    },
  );
};

export default subscriberRoutes;
