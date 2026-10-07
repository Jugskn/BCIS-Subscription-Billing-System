import Fastify from "fastify";
import cors from "@fastify/cors";
import type { AppConfig } from "./config.js";
import { friendlyMessages, isAppError } from "./lib/errors.js";
import dbPlugin from "./plugins/db.js";
import authPlugin from "./plugins/auth.js";
import healthRoutes from "./routes/health.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";

export async function buildApp(config: AppConfig) {
  const app = Fastify({
    logger: {
      level: "info",
      redact: [
        "req.headers.authorization",
        "req.body.password",
        "body.password",
        "password",
        "passwordHash",
        "*.password",
        "*.passwordHash",
      ],
    },
  });

  // Must be registered before encapsulated route plugins so children inherit it.
  app.setErrorHandler((error, request, reply) => {
    if (isAppError(error)) {
      const message = error.expose
        ? error.message
        : (friendlyMessages[error.statusCode] ?? friendlyMessages[500]!);
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message,
        },
      });
    }

    if (
      error &&
      typeof error === "object" &&
      "validation" in error &&
      error.validation
    ) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: friendlyMessages[400],
        },
      });
    }

    request.log.error({ err: error }, "Unhandled error");
    return reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: friendlyMessages[500],
      },
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: friendlyMessages[404],
      },
    });
  });

  await app.register(cors, { origin: true });
  await app.register(dbPlugin, { connectionString: config.DATABASE_URL });
  await app.register(authPlugin, { secret: config.JWT_SECRET });

  await app.register(healthRoutes);
  await app.register(authRoutes, {
    maxAttempts: config.LOGIN_MAX_ATTEMPTS,
    lockoutMinutes: config.LOGIN_LOCKOUT_MINUTES,
  });
  await app.register(userRoutes);

  return app;
}
