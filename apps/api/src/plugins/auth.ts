import fp from "fastify-plugin";
import fjwt from "@fastify/jwt";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { PermissionCode } from "@bcis/shared";
import { AppError } from "../lib/errors.js";

export type AuthUser = {
  id: string;
  username: string;
  fullName: string;
  roles: string[];
  permissions: string[];
  sessionVersion: number;
};

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      sub: string;
      sv: number;
    };
    user: AuthUser;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    requirePermission: (
      permission: PermissionCode,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const authPlugin: FastifyPluginAsync<{ secret: string }> = async (app, opts) => {
  await app.register(fjwt, { secret: opts.secret });

  app.decorate(
    "authenticate",
    async (request: FastifyRequest, _reply: FastifyReply) => {
      try {
        const payload = await request.jwtVerify<{ sub: string; sv: number }>();
        const { users } = await import("@bcis/db");
        const { eq } = await import("drizzle-orm");
        const { getUserAuthContext } = await import(
          "../services/auth-service.js"
        );

        const rows = await app.db
          .select()
          .from(users)
          .where(eq(users.id, payload.sub))
          .limit(1);
        const user = rows[0];
        if (!user || !user.isActive) {
          throw new AppError(401, "UNAUTHORIZED", "Please sign in to continue.");
        }
        if (user.sessionVersion !== payload.sv) {
          throw new AppError(
            401,
            "SESSION_REVOKED",
            "Your session has ended. Please sign in again.",
          );
        }
        if (user.lockedUntil && user.lockedUntil > new Date()) {
          throw new AppError(
            423,
            "ACCOUNT_LOCKED",
            "This account is temporarily locked. Try again later.",
          );
        }

        const ctx = await getUserAuthContext(app.db, user.id);
        request.user = {
          id: user.id,
          username: user.username,
          fullName: user.fullName,
          roles: ctx.roles,
          permissions: ctx.permissions,
          sessionVersion: user.sessionVersion,
        };
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(401, "UNAUTHORIZED", "Please sign in to continue.", {
          cause: error,
        });
      }
    },
  );

  app.decorate("requirePermission", (permission: PermissionCode) => {
    return async (request: FastifyRequest, _reply: FastifyReply) => {
      await app.authenticate(request, _reply);
      if (!request.user.permissions.includes(permission)) {
        throw new AppError(
          403,
          "FORBIDDEN",
          "You do not have permission to perform this action.",
        );
      }
    };
  });
};

export default fp(authPlugin, { name: "auth", dependencies: ["db"] });
