import type { FastifyPluginAsync } from "fastify";
import {
  collectionAreaListQuerySchema,
  createCollectionAreaSchema,
  optionsSearchQuerySchema,
  updateCollectionAreaSchema,
} from "@bcis/shared";
import { validationError } from "../lib/errors.js";
import { listAreaOptions } from "../services/options-service.js";
import {
  createCollectionArea,
  deleteCollectionArea,
  listCollectionAreas,
  updateCollectionArea,
} from "../services/collection-area-service.js";

function normalizeAreaBody(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const record = body as Record<string, unknown>;
  if (!("description" in record)) return body;
  return {
    ...record,
    description: record.description === "" ? null : record.description,
  };
}

const collectionAreaRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/areas/options",
    { preHandler: [app.requirePermission("subscriber.view")] },
    async (request) => {
      const parsed = optionsSearchQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid options query.", parsed.error);
      }
      return listAreaOptions(app.db, parsed.data.search);
    },
  );

  app.get(
    "/collection-areas",
    { preHandler: [app.requirePermission("subscriber.view")] },
    async (request) => {
      const parsed = collectionAreaListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid list query.", parsed.error);
      }
      return listCollectionAreas(app.db, parsed.data);
    },
  );

  app.post(
    "/collection-areas",
    { preHandler: [app.requirePermission("collection.create")] },
    async (request, reply) => {
      const parsed = createCollectionAreaSchema.safeParse(
        normalizeAreaBody(request.body),
      );
      if (!parsed.success) {
        throw validationError(
          "Please check the area details and try again.",
          parsed.error,
        );
      }
      const area = await createCollectionArea(
        app.db,
        request.user.id,
        parsed.data,
      );
      return reply.code(201).send(area);
    },
  );

  app.put(
    "/collection-areas/:id",
    { preHandler: [app.requirePermission("collection.create")] },
    async (request) => {
      const { id } = request.params as { id: string };
      const parsed = updateCollectionAreaSchema.safeParse(
        normalizeAreaBody(request.body),
      );
      if (!parsed.success) {
        throw validationError("Invalid update payload.", parsed.error);
      }
      return updateCollectionArea(app.db, request.user.id, id, parsed.data);
    },
  );

  app.delete(
    "/collection-areas/:id",
    { preHandler: [app.requirePermission("collection.create")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await deleteCollectionArea(app.db, request.user.id, id);
      return reply.code(204).send();
    },
  );
};

export default collectionAreaRoutes;
