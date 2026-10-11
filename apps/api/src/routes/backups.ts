import type { FastifyPluginAsync } from "fastify";
import { restoreBackupSchema } from "@bcis/shared";
import { validationError } from "../lib/errors.js";
import {
  backupsRoot,
  createBackup,
  listBackupHistory,
  listBackups,
  restoreBackup,
  verifyBackup,
} from "../services/backup-service.js";

const backupRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/backups",
    { preHandler: [app.requirePermission("backup.create")] },
    async () => listBackups(app.config),
  );

  app.get(
    "/backups/history",
    { preHandler: [app.requirePermission("backup.create")] },
    async () => listBackupHistory(app.db),
  );

  app.get(
    "/backups/root",
    { preHandler: [app.requirePermission("backup.create")] },
    async () => ({ path: backupsRoot(app.config) }),
  );

  app.post(
    "/backups",
    { preHandler: [app.requirePermission("backup.create")] },
    async (request, reply) => {
      const backup = await createBackup(app.db, app.config, request.user.id);
      return reply.code(201).send(backup);
    },
  );

  app.post(
    "/backups/:id/verify",
    { preHandler: [app.requirePermission("backup.create")] },
    async (request) => {
      const { id } = request.params as { id: string };
      return verifyBackup(app.db, app.config, request.user.id, id);
    },
  );

  app.post(
    "/backups/:id/restore",
    { preHandler: [app.requirePermission("backup.restore")] },
    async (request) => {
      const { id } = request.params as { id: string };
      const parsed = restoreBackupSchema.safeParse({
        backupId: id,
        ...(request.body as object),
      });
      if (!parsed.success) {
        throw validationError(
          'Type "RESTORE" to confirm restore.',
          parsed.error,
        );
      }
      return restoreBackup(app.db, app.config, request.user.id, id);
    },
  );
};

export default backupRoutes;
