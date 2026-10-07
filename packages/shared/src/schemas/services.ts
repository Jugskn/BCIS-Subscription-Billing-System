import { z } from "zod";
import { moneyInputSchema, centavosToString } from "./money.js";
import { paginationQuerySchema } from "./users.js";

export const SERVICE_TYPE_CODES = ["INTERNET", "CABLE", "COMBO"] as const;

export const createServicePlanSchema = z
  .object({
    serviceTypeCode: z.enum(SERVICE_TYPE_CODES),
    code: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .regex(/^[A-Z0-9_-]+$/i, "Code must be alphanumeric."),
    name: z.string().trim().min(1),
    description: z.string().trim().optional(),
    price: moneyInputSchema,
    installationFee: moneyInputSchema.optional(),
    speedMbps: z.coerce.number().int().positive().optional(),
    channelCount: z.coerce.number().int().positive().optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.serviceTypeCode === "INTERNET" && !data.speedMbps) {
      ctx.addIssue({
        code: "custom",
        message: "Internet plans require speed (Mbps).",
        path: ["speedMbps"],
      });
    }
    if (data.serviceTypeCode === "CABLE" && !data.channelCount) {
      ctx.addIssue({
        code: "custom",
        message: "Cable plans require channel count.",
        path: ["channelCount"],
      });
    }
  });

export type CreateServicePlanInput = z.infer<typeof createServicePlanSchema>;

export const updateServicePlanSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().optional(),
  price: moneyInputSchema.optional(),
  installationFee: moneyInputSchema.optional(),
  speedMbps: z.coerce.number().int().positive().optional().nullable(),
  channelCount: z.coerce.number().int().positive().optional().nullable(),
  isActive: z.boolean().optional(),
});

export type UpdateServicePlanInput = z.infer<typeof updateServicePlanSchema>;

export const servicePlanListQuerySchema = paginationQuerySchema.extend({
  serviceTypeCode: z.enum(SERVICE_TYPE_CODES).optional(),
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});

export const servicePlanListItemSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string(),
  serviceTypeCode: z.string(),
  serviceTypeName: z.string(),
  priceCentavos: z.string(),
  installationFeeCentavos: z.string(),
  speedMbps: z.number().nullable(),
  channelCount: z.number().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
});

export type ServicePlanListItem = z.infer<typeof servicePlanListItemSchema>;

export { centavosToString };
