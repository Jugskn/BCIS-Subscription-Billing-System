import { z } from "zod";
import { centavosStringSchema } from "./money.js";

export const createSuspensionSchema = z.object({
  serviceAccountId: z.string().uuid(),
  reason: z.string().trim().min(1),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Approver user id; defaults to the authenticated actor when omitted. */
  approvedBy: z.string().uuid().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

export type CreateSuspensionInput = z.infer<typeof createSuspensionSchema>;

export const createReconnectionSchema = z.object({
  serviceAccountId: z.string().uuid(),
  suspensionId: z.string().uuid().optional().nullable(),
  feeCentavos: centavosStringSchema.optional(),
  technicianUserId: z.string().uuid().optional().nullable(),
  requestDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  notes: z.string().trim().optional().nullable(),
});

export type CreateReconnectionInput = z.infer<typeof createReconnectionSchema>;

export const completeReconnectionSchema = z.object({
  notes: z.string().trim().optional().nullable(),
});
