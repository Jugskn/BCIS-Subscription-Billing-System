import { z } from "zod";
import { paginationQuerySchema } from "./users.js";
import { SERVICE_TYPE_CODES } from "./services.js";
import { exportFormatSchema } from "./reports.js";

/** Delinquency buckets for overdue filters (excludes Current). */
export const DELINQUENCY_AGE_BUCKETS = ["1-30", "31-60", "61-90", "90+"] as const;
export type DelinquencyAgeBucket = (typeof DELINQUENCY_AGE_BUCKETS)[number];

const receivablesFilterSchema = z.object({
  collectionAreaId: z.string().uuid().optional(),
  collectorUserId: z.string().uuid().optional(),
  servicePlanId: z.string().uuid().optional(),
  serviceTypeCode: z.enum(SERVICE_TYPE_CODES).optional(),
});

export const outstandingListQuerySchema = paginationQuerySchema.merge(
  receivablesFilterSchema,
);
export type OutstandingListQuery = z.infer<typeof outstandingListQuerySchema>;

export const overdueListQuerySchema = paginationQuerySchema
  .merge(receivablesFilterSchema)
  .extend({
    delinquencyAgeBucket: z.enum(DELINQUENCY_AGE_BUCKETS).optional(),
  });
export type OverdueListQuery = z.infer<typeof overdueListQuerySchema>;

export const overdueExportQuerySchema = overdueListQuerySchema.extend({
  format: exportFormatSchema.default("xlsx"),
});
export type OverdueExportQuery = z.infer<typeof overdueExportQuerySchema>;

export const suspensionCandidatesQuerySchema = paginationQuerySchema.merge(
  receivablesFilterSchema,
);
export type SuspensionCandidatesQuery = z.infer<
  typeof suspensionCandidatesQuerySchema
>;

export const suspensionHistoryQuerySchema = paginationQuerySchema;
export type SuspensionHistoryQuery = z.infer<typeof suspensionHistoryQuerySchema>;
