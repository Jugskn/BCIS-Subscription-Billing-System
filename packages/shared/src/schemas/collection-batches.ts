import { z } from "zod";
import { paginationQuerySchema } from "./users.js";
import { centavosStringSchema } from "./money.js";

export const COLLECTION_BATCH_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "SUBMITTED",
  "REMITTED",
  "RECONCILED",
  "CLOSED",
] as const;

export type CollectionBatchStatus = (typeof COLLECTION_BATCH_STATUSES)[number];

export const createCollectionBatchSchema = z.object({
  collectorUserId: z.string().uuid(),
  collectionAreaId: z.string().uuid().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  accounts: z
    .array(
      z.object({
        subscriberId: z.string().uuid(),
        serviceAccountId: z.string().uuid().optional().nullable(),
        expectedCentavos: centavosStringSchema,
      }),
    )
    .default([]),
});

export type CreateCollectionBatchInput = z.infer<
  typeof createCollectionBatchSchema
>;

export const recordBatchCollectionSchema = z.object({
  subscriberId: z.string().uuid(),
  serviceAccountId: z.string().uuid().optional().nullable(),
  collectedCentavos: centavosStringSchema,
  paymentId: z.string().uuid().optional().nullable(),
  isCash: z.boolean().default(true),
  notes: z.string().trim().optional().nullable(),
});

export type RecordBatchCollectionInput = z.infer<
  typeof recordBatchCollectionSchema
>;

export const remitBatchSchema = z.object({
  remittedCashCentavos: centavosStringSchema,
  shortageReason: z.string().trim().min(1).optional().nullable(),
});

export type RemitBatchInput = z.infer<typeof remitBatchSchema>;

export const collectionBatchListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(COLLECTION_BATCH_STATUSES).optional(),
  collectorUserId: z.string().uuid().optional(),
  collectionAreaId: z.string().uuid().optional(),
});

export type CollectionBatchListQuery = z.infer<
  typeof collectionBatchListQuerySchema
>;

export const collectionBatchAccountSchema = z.object({
  id: z.string().uuid(),
  subscriberId: z.string().uuid(),
  subscriberAccountNumber: z.string(),
  subscriberName: z.string(),
  subscriberAddress: z.string(),
  serviceAccountId: z.string().uuid().nullable(),
  expectedCentavos: z.string(),
  collectedCentavos: z.string(),
  paymentId: z.string().uuid().nullable(),
  notes: z.string().nullable(),
});

export const collectionBatchListItemSchema = z.object({
  id: z.string().uuid(),
  batchNumber: z.string(),
  collectorUserId: z.string().uuid(),
  collectorName: z.string().nullable(),
  collectionAreaId: z.string().uuid().nullable(),
  collectionAreaName: z.string().nullable(),
  status: z.enum(COLLECTION_BATCH_STATUSES),
  accountCount: z.number().int().nonnegative(),
  expectedCashCentavos: z.string(),
  collectedCashCentavos: z.string(),
  collectedNonCashCentavos: z.string(),
  remittedCashCentavos: z.string().nullable(),
  differenceCentavos: z.string().nullable(),
  shortageReason: z.string().nullable(),
  notes: z.string().nullable(),
  closedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const collectionBatchDetailSchema = collectionBatchListItemSchema.extend({
  accounts: z.array(collectionBatchAccountSchema),
});

export type CollectionBatchListItem = z.infer<
  typeof collectionBatchListItemSchema
>;
export type CollectionBatchDetail = z.infer<typeof collectionBatchDetailSchema>;

export const collectorSummaryListQuerySchema = paginationQuerySchema;

export const collectorAreaSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
});

export const collectorSummarySchema = z.object({
  collectorUserId: z.string().uuid(),
  collectorName: z.string(),
  username: z.string(),
  assignedAreas: z.array(collectorAreaSchema),
  subscriberCount: z.number().int().nonnegative(),
  openBatchCount: z.number().int().nonnegative(),
  currentMonthCollectedCentavos: z.string(),
  remittanceDifferenceCentavos: z.string(),
});

export type CollectorSummary = z.infer<typeof collectorSummarySchema>;

export const collectorAreaAssignmentSchema = z.object({
  collectionAreaId: z.string().uuid(),
});

export type CollectorAreaAssignmentInput = z.infer<
  typeof collectorAreaAssignmentSchema
>;

export const collectorIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const collectorAreaParamsSchema = collectorIdParamsSchema.extend({
  areaId: z.string().uuid(),
});

export const subscriberCollectionHistoryQuerySchema = paginationQuerySchema;

export const subscriberCollectionHistoryItemSchema = z.object({
  batchAccountId: z.string().uuid(),
  batchId: z.string().uuid(),
  batchNumber: z.string(),
  batchStatus: z.enum(COLLECTION_BATCH_STATUSES),
  collectorUserId: z.string().uuid(),
  collectorName: z.string().nullable(),
  collectionAreaId: z.string().uuid().nullable(),
  collectionAreaName: z.string().nullable(),
  expectedCentavos: z.string(),
  collectedCentavos: z.string(),
  paymentId: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  recordedAt: z.string(),
});

export const subscriberCollectionHistorySchema = z.object({
  subscriberId: z.string().uuid(),
  accountNumber: z.string(),
  subscriberName: z.string(),
  assignedArea: collectorAreaSchema.nullable(),
  assignedCollector: z
    .object({
      id: z.string().uuid(),
      name: z.string(),
    })
    .nullable(),
  items: z.array(subscriberCollectionHistoryItemSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});

export type SubscriberCollectionHistory = z.infer<
  typeof subscriberCollectionHistorySchema
>;
