import type { FastifyPluginAsync } from "fastify";
import {
  assignRolesSchema,
  createUserSchema,
  optionsSearchQuerySchema,
  paginationQuerySchema,
} from "@bcis/shared";
import { validationError } from "../lib/errors.js";
import { listCollectorOptions } from "../services/options-service.js";
import {
  assignUserRoles,
  createUser,
  deactivateUser,
  listUsers,
} from "../services/user-service.js";

const userRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/collectors/options",
    { preHandler: [app.requirePermission("subscriber.view")] },
    async (request) => {
      const parsed = optionsSearchQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid options query.", parsed.error);
      }
      return listCollectorOptions(app.db, parsed.data.search);
    },
  );

  app.get(
    "/users",
    { preHandler: [app.requirePermission("user.manage")] },
    async (request) => {
      const parsed = paginationQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid pagination query.", parsed.error);
      }
      return listUsers(app.db, parsed.data);
    },
  );

  app.post(
    "/users",
    { preHandler: [app.requirePermission("user.manage")] },
    async (request, reply) => {
      const parsed = createUserSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationError(
          "Please check the user details and try again.",
          parsed.error,
        );
      }
      const user = await createUser(app.db, request.user.id, parsed.data);
      return reply.code(201).send(user);
    },
  );

  app.post(
    "/users/:id/deactivate",
    { preHandler: [app.requirePermission("user.manage")] },
    async (request) => {
      const { id } = request.params as { id: string };
      await deactivateUser(app.db, request.user.id, id);
      return { ok: true };
    },
  );

  app.put(
    "/users/:id/roles",
    { preHandler: [app.requirePermission("user.manage")] },
    async (request) => {
      const { id } = request.params as { id: string };
      const parsed = assignRolesSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationError("Select at least one role.", parsed.error);
      }
      await assignUserRoles(app.db, request.user.id, id, parsed.data.roleNames);
      return { ok: true };
    },
  );
};

export default userRoutes;
