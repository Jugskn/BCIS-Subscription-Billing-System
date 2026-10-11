import type { FastifyPluginAsync } from "fastify";
import {
  restoreSettingsSectionSchema,
  settingsHistoryQuerySchema,
  updateSettingsSchema,
} from "@bcis/shared";
import { validationError } from "../lib/errors.js";
import {
  getCompanyProfile,
  getSettingsDto,
  listSettingsChangeHistory,
  restoreSettingsSection,
  updateSettings,
} from "../services/settings-service.js";

const settingsRoutes: FastifyPluginAsync = async (app) => {
  /** Company header fields for receipts/SOA/reports — any authenticated user. */
  app.get(
    "/settings/company",
    { preHandler: [app.authenticate] },
    async () => getCompanyProfile(app.db),
  );

  app.get(
    "/settings",
    { preHandler: [app.requirePermission("settings.view")] },
    async (request) => {
      const canManage = request.user.permissions.includes("settings.manage");
      const host = request.headers.host ?? `${app.config.API_HOST}:${app.config.API_PORT}`;
      const proto =
        (request.headers["x-forwarded-proto"] as string | undefined) ?? "http";
      const apiBaseUrl = `${proto}://${host}`;
      return getSettingsDto(app.db, app.config, { canManage, apiBaseUrl });
    },
  );

  app.put(
    "/settings",
    { preHandler: [app.requirePermission("settings.manage")] },
    async (request) => {
      const parsed = updateSettingsSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationError("Invalid settings.", parsed.error);
      }
      const result = await updateSettings(app.db, request.user.id, parsed.data);
      const canManage = true;
      const host = request.headers.host ?? `${app.config.API_HOST}:${app.config.API_PORT}`;
      const proto =
        (request.headers["x-forwarded-proto"] as string | undefined) ?? "http";
      const dto = await getSettingsDto(app.db, app.config, {
        canManage,
        apiBaseUrl: `${proto}://${host}`,
      });
      return { ...dto, changed: result.changed };
    },
  );

  app.post(
    "/settings/restore-defaults",
    { preHandler: [app.requirePermission("settings.manage")] },
    async (request) => {
      const parsed = restoreSettingsSectionSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationError("Invalid restore request.", parsed.error);
      }
      const result = await restoreSettingsSection(
        app.db,
        request.user.id,
        parsed.data.section,
      );
      const host = request.headers.host ?? `${app.config.API_HOST}:${app.config.API_PORT}`;
      const proto =
        (request.headers["x-forwarded-proto"] as string | undefined) ?? "http";
      const dto = await getSettingsDto(app.db, app.config, {
        canManage: true,
        apiBaseUrl: `${proto}://${host}`,
      });
      return { ...dto, restored: result.restored };
    },
  );

  app.get(
    "/settings/history",
    { preHandler: [app.requirePermission("settings.view")] },
    async (request) => {
      const parsed = settingsHistoryQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw validationError("Invalid history query.", parsed.error);
      }
      return listSettingsChangeHistory(app.db, parsed.data);
    },
  );
};

export default settingsRoutes;
