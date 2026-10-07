import Fastify from "fastify";
import cors from "@fastify/cors";
import type { AppConfig } from "./config.js";
import {
  friendlyMessages,
  isAppError,
  type ValidationIssue,
} from "./lib/errors.js";
import dbPlugin from "./plugins/db.js";
import authPlugin from "./plugins/auth.js";
import healthRoutes from "./routes/health.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import subscriberRoutes from "./routes/subscribers.js";
import servicePlanRoutes from "./routes/service-plans.js";
import collectionAreaRoutes from "./routes/collection-areas.js";
import serviceAccountRoutes from "./routes/service-accounts.js";
import billingRoutes from "./routes/billing.js";
import paymentRoutes from "./routes/payments.js";
import dashboardRoutes from "./routes/dashboard.js";
import receivablesRoutes from "./routes/receivables.js";
import reportsRoutes from "./routes/reports.js";

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
      const body: {
        code: string;
        message: string;
        issues?: ValidationIssue[];
      } = { code: error.code, message };
      if (error.code === "VALIDATION_ERROR") {
        const issues = error.issues ?? [];
        body.issues = issues;
        request.log.warn({ issues }, "Validation failed");
      }
      return reply.status(error.statusCode).send({ error: body });
    }

    if (
      error &&
      typeof error === "object" &&
      "validation" in error &&
      error.validation
    ) {
      const raw = error.validation as Array<{
        instancePath?: string;
        message?: string;
        params?: { missingProperty?: string };
      }>;
      const issues: ValidationIssue[] = raw.map((v) => ({
        field:
          (v.instancePath
            ? v.instancePath.replace(/^\//, "").replace(/\//g, ".")
            : null) ||
          v.params?.missingProperty ||
          "_root",
        message: v.message ?? "Invalid value",
      }));
      request.log.warn({ issues }, "Validation failed");
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: friendlyMessages[400],
          issues,
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

  // onRequest answers OPTIONS before route preHandlers (auth/permission).
  // @fastify/cors v11 defaults methods to GET,HEAD,POST only — PUT/PATCH/DELETE need listing.
  await app.register(cors, {
    hook: "onRequest",
    origin: config.corsOrigins,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Idempotency-Key",
      "Accept",
    ],
  });
  await app.register(dbPlugin, { connectionString: config.DATABASE_URL });
  await app.register(authPlugin, { secret: config.JWT_SECRET });

  await app.register(healthRoutes);
  await app.register(authRoutes, {
    maxAttempts: config.LOGIN_MAX_ATTEMPTS,
    lockoutMinutes: config.LOGIN_LOCKOUT_MINUTES,
  });
  await app.register(userRoutes);
  await app.register(subscriberRoutes);
  await app.register(servicePlanRoutes);
  await app.register(collectionAreaRoutes);
  await app.register(serviceAccountRoutes);
  await app.register(billingRoutes);
  await app.register(paymentRoutes, {
    uploadDir: config.UPLOAD_DIR,
    maxProofBytes: config.MAX_PROOF_BYTES,
  });
  await app.register(dashboardRoutes);
  await app.register(receivablesRoutes);
  await app.register(reportsRoutes);

  return app;
}
