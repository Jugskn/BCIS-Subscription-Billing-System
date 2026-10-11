import type { FastifyPluginAsync } from "fastify";
import {
  collectionBatchListQuerySchema,
  collectorAreaAssignmentSchema,
  collectorAreaParamsSchema,
  collectorIdParamsSchema,
  collectorSummaryListQuerySchema,
  createCollectionBatchSchema,
  recordBatchCollectionSchema,
  remitBatchSchema,
} from "@bcis/shared";
import { validationError } from "../lib/errors.js";
import {
  assignCollectorArea,
  closeCollectionBatch,
  createCollectionBatch,
  getCollectionBatch,
  listCollectorSummaries,
  listCollectionBatches,
  recordBatchCollection,
  reconcileCollectionBatch,
  remitCollectionBatch,
  startCollectionBatch,
  submitCollectionBatch,
  unassignCollectorArea,
} from "../services/collection-batch-service.js";

const collectionBatchRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/collectors",
    { preHandler: [app.requirePermission("collection.create")] },
    async (request) => {
      const parsed = collectorSummaryListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid collector list query.", parsed.error);
      }
      return listCollectorSummaries(app.db, parsed.data);
    },
  );

  app.post(
    "/collectors/:id/areas",
    { preHandler: [app.requirePermission("collection.create")] },
    async (request, reply) => {
      const params = collectorIdParamsSchema.safeParse(request.params);
      const body = collectorAreaAssignmentSchema.safeParse(request.body);
      if (!params.success) {
        throw validationError("Invalid collector identifier.", params.error);
      }
      if (!body.success) {
        throw validationError("Invalid area assignment.", body.error);
      }
      const result = await assignCollectorArea(
        app.db,
        request.user.id,
        params.data.id,
        body.data,
      );
      return reply.code(201).send(result);
    },
  );

  app.delete(
    "/collectors/:id/areas/:areaId",
    { preHandler: [app.requirePermission("collection.create")] },
    async (request) => {
      const parsed = collectorAreaParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        throw validationError("Invalid area assignment identifier.", parsed.error);
      }
      return unassignCollectorArea(
        app.db,
        request.user.id,
        parsed.data.id,
        parsed.data.areaId,
      );
    },
  );

  app.get(
    "/collection-batches",
    { preHandler: [app.requirePermission("collection.create")] },
    async (request) => {
      const parsed = collectionBatchListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid list query.", parsed.error);
      }
      return listCollectionBatches(app.db, parsed.data);
    },
  );

  app.get(
    "/collection-batches/:id",
    { preHandler: [app.requirePermission("collection.create")] },
    async (request) => {
      const { id } = request.params as { id: string };
      return getCollectionBatch(app.db, id);
    },
  );

  app.post(
    "/collection-batches",
    { preHandler: [app.requirePermission("collection.create")] },
    async (request, reply) => {
      const parsed = createCollectionBatchSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationError("Invalid batch payload.", parsed.error);
      }
      const batch = await createCollectionBatch(
        app.db,
        request.user.id,
        parsed.data,
      );
      return reply.code(201).send(batch);
    },
  );

  app.post(
    "/collection-batches/:id/start",
    { preHandler: [app.requirePermission("collection.create")] },
    async (request) => {
      const { id } = request.params as { id: string };
      return startCollectionBatch(app.db, request.user.id, id);
    },
  );

  app.post(
    "/collection-batches/:id/collections",
    { preHandler: [app.requirePermission("collection.create")] },
    async (request) => {
      const { id } = request.params as { id: string };
      const parsed = recordBatchCollectionSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationError("Invalid collection payload.", parsed.error);
      }
      return recordBatchCollection(app.db, request.user.id, id, parsed.data);
    },
  );

  app.post(
    "/collection-batches/:id/submit",
    { preHandler: [app.requirePermission("collection.create")] },
    async (request) => {
      const { id } = request.params as { id: string };
      return submitCollectionBatch(app.db, request.user.id, id);
    },
  );

  app.post(
    "/collection-batches/:id/remit",
    { preHandler: [app.requirePermission("collection.reconcile")] },
    async (request) => {
      const { id } = request.params as { id: string };
      const parsed = remitBatchSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationError("Invalid remittance payload.", parsed.error);
      }
      return remitCollectionBatch(app.db, request.user.id, id, parsed.data);
    },
  );

  app.post(
    "/collection-batches/:id/reconcile",
    { preHandler: [app.requirePermission("collection.reconcile")] },
    async (request) => {
      const { id } = request.params as { id: string };
      return reconcileCollectionBatch(app.db, request.user.id, id);
    },
  );

  app.post(
    "/collection-batches/:id/close",
    { preHandler: [app.requirePermission("collection.reconcile")] },
    async (request) => {
      const { id } = request.params as { id: string };
      return closeCollectionBatch(app.db, request.user.id, id);
    },
  );
};

export default collectionBatchRoutes;
