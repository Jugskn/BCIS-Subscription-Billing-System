import type { FastifyPluginAsync } from "fastify";
import {
  assignRolesSchema,
  createUserSchema,
  paginationQuerySchema,
} from "@bcis/shared";
import { AppError } from "../lib/errors.js";
import {
  assignUserRoles,
  createUser,
  deactivateUser,
  listUsers,
} from "../services/user-service.js";

const userRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/users",
    { preHandler: [app.requirePermission("user.manage")] },
    async (request) => {
      const parsed = paginationQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Invalid pagination query.");
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
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "Please check the user details and try again.",
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
        throw new AppError(400, "VALIDATION_ERROR", "Select at least one role.");
      }
      await assignUserRoles(app.db, request.user.id, id, parsed.data.roleNames);
      return { ok: true };
    },
  );
};

export default userRoutes;
