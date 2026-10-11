import type { FastifyPluginAsync } from "fastify";
import { loginRequestSchema } from "@bcis/shared";
import { AppError } from "../lib/errors.js";
import { loginUser, logoutUser } from "../services/auth-service.js";
import {
  getLoginSecuritySettings,
  getSessionTimeoutMinutes,
} from "../services/settings-service.js";

const authRoutes: FastifyPluginAsync<{
  maxAttempts: number;
  lockoutMinutes: number;
}> = async (app, opts) => {
  app.post("/auth/login", async (request) => {
    const parsed = loginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", "Username and password are required.");
    }

    let maxAttempts = opts.maxAttempts;
    let lockoutMinutes = opts.lockoutMinutes;
    try {
      const live = await getLoginSecuritySettings(app.db);
      maxAttempts = live.maxAttempts;
      lockoutMinutes = live.lockoutMinutes;
    } catch {
      // Fall back to env defaults if settings unavailable.
    }

    const result = await loginUser(app.db, {
      username: parsed.data.username,
      password: parsed.data.password,
      maxAttempts,
      lockoutMinutes,
    });

    const token = await app.jwt.sign(
      { sub: result.user.id, sv: result.user.sessionVersion },
      { expiresIn: "12h" },
    );

    let sessionTimeoutMinutes = 30;
    try {
      sessionTimeoutMinutes = await getSessionTimeoutMinutes(app.db);
    } catch {
      // keep default
    }

    return {
      token,
      user: {
        id: result.user.id,
        username: result.user.username,
        fullName: result.user.fullName,
        roles: result.user.roles,
        permissions: result.user.permissions,
      },
      sessionTimeoutMinutes,
    };
  });

  app.post(
    "/auth/logout",
    { preHandler: [app.authenticate] },
    async (request) => {
      await logoutUser(app.db, request.user.id);
      return { ok: true };
    },
  );

  app.get(
    "/auth/me",
    { preHandler: [app.authenticate] },
    async (request) => {
      let sessionTimeoutMinutes = 30;
      try {
        sessionTimeoutMinutes = await getSessionTimeoutMinutes(app.db);
      } catch {
        // keep default
      }
      return {
        user: {
          id: request.user.id,
          username: request.user.username,
          fullName: request.user.fullName,
          roles: request.user.roles,
          permissions: request.user.permissions,
        },
        sessionTimeoutMinutes,
      };
    },
  );
};

export default authRoutes;
