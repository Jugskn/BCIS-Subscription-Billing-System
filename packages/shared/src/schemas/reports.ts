import { z } from "zod";
import { paginationQuerySchema } from "./users.js";
import { AGING_BUCKETS } from "../billing/aging.js";
import { PAYMENT_METHODS } from "../billing/allocation.js";

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD.");

export const exportFormatSchema = z.enum(["pdf", "xlsx", "csv"]);
export type ExportFormat = z.infer<typeof exportFormatSchema>;

export const collectionPeriodSchema = z.enum([
  "daily",
  "weekly",
  "monthly",
  "annual",
]);

export const dateRangeQuerySchema = z
  .object({
    fromDate: isoDateSchema.optional(),
    toDate: isoDateSchema.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.fromDate && val.toDate && val.fromDate > val.toDate) {
      ctx.addIssue({
        code: "custom",
        message: "fromDate must be on or before toDate.",
        path: ["fromDate"],
      });
    }
  });

export const reportPaginationSchema = paginationQuerySchema.merge(
  dateRangeQuerySchema,
);

export const collectionsReportQuerySchema = reportPaginationSchema.extend({
  period: collectionPeriodSchema.optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  collectorUserId: z.string().uuid().optional(),
  collectionAreaId: z.string().uuid().optional(),
});

export const paymentMethodReportQuerySchema = reportPaginationSchema;

export const billingVsCollectionQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(24).default(12),
});

export const revenueReportQuerySchema = reportPaginationSchema.extend({
  groupBy: z.enum(["plan", "serviceType", "area"]).default("plan"),
});

export const arAgingReportQuerySchema = paginationQuerySchema.extend({
  asOfDate: isoDateSchema.optional(),
  collectionAreaId: z.string().uuid().optional(),
  collectorUserId: z.string().uuid().optional(),
});

export const subscriberMasterQuerySchema = paginationQuerySchema.extend({
  status: z
    .enum(["ACTIVE", "INACTIVE", "TERMINATED", "ARCHIVED"])
    .optional(),
  collectionAreaId: z.string().uuid().optional(),
  collectorUserId: z.string().uuid().optional(),
});

export const ledgerReportQuerySchema = z.object({
  subscriberId: z.string().uuid(),
  fromDate: isoDateSchema,
  toDate: isoDateSchema,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const collectorReportQuerySchema = reportPaginationSchema.extend({
  collectorUserId: z.string().uuid().optional(),
});

export const reversalsReportQuerySchema = reportPaginationSchema;

export const auditReportQuerySchema = paginationQuerySchema.extend({
  fromDate: isoDateSchema.optional(),
  toDate: isoDateSchema.optional(),
  actorUserId: z.string().uuid().optional(),
  action: z.string().trim().optional(),
});

export const exportQuerySchema = z.object({
  format: exportFormatSchema.default("xlsx"),
});

export const agingBucketSchema = z.enum(AGING_BUCKETS);

export const agingBucketTotalSchema = z.object({
  bucket: agingBucketSchema,
  balanceCentavos: z.string(),
  invoiceCount: z.number().int(),
});

export const arAgingSummarySchema = z.object({
  asOfDate: z.string(),
  graceDays: z.number().int(),
  buckets: z.array(agingBucketTotalSchema),
  totalBalanceCentavos: z.string(),
  totalInvoiceCount: z.number().int(),
});

export type ArAgingSummaryDto = z.infer<typeof arAgingSummarySchema>;

export const dashboardKpisSchema = z.object({
  todayCollectionsCentavos: z.string(),
  currentReceivableCentavos: z.string(),
  overdueReceivableCentavos: z.string(),
  subscribersOverdueCount: z.number().int(),
  pendingGcashCount: z.number().int(),
});

export const dashboardSchema = z.object({
  kpis: dashboardKpisSchema,
  billingVsCollection: z.array(
    z.object({
      month: z.string(),
      billedCentavos: z.string(),
      collectedCentavos: z.string(),
    }),
  ),
  paymentMethods: z.array(
    z.object({
      method: z.string(),
      amountCentavos: z.string(),
      count: z.number().int(),
    }),
  ),
  arAging: arAgingSummarySchema,
  collectorPerformance: z.array(
    z.object({
      collectorUserId: z.string().nullable(),
      collectorName: z.string(),
      collectedCentavos: z.string(),
      paymentCount: z.number().int(),
      assignedSubscribers: z.number().int(),
    }),
  ),
  overdueAlerts: z.array(
    z.object({
      subscriberId: z.string().uuid(),
      accountNumber: z.string(),
      fullName: z.string(),
      arrearsCentavos: z.string(),
      oldestDueDate: z.string(),
    }),
  ),
  recentPayments: z.array(
    z.object({
      id: z.string().uuid(),
      receivedAt: z.string(),
      subscriberName: z.string(),
      accountNumber: z.string(),
      method: z.string(),
      amountCentavos: z.string(),
      receiptNumber: z.string().nullable(),
    }),
  ),
});

export type DashboardDto = z.infer<typeof dashboardSchema>;

export const routeSheetQuerySchema = z.object({
  collectionAreaId: z.string().uuid(),
  collectorUserId: z.string().uuid().optional(),
});

export const routeSheetSchema = z.object({
  areaCode: z.string(),
  areaName: z.string(),
  generatedAt: z.string(),
  rows: z.array(
    z.object({
      accountNumber: z.string(),
      fullName: z.string(),
      address: z.string(),
      contactPhone: z.string().nullable(),
      currentBillCentavos: z.string(),
      arrearsCentavos: z.string(),
      totalDueCentavos: z.string(),
    }),
  ),
  totals: z.object({
    currentBillCentavos: z.string(),
    arrearsCentavos: z.string(),
    totalDueCentavos: z.string(),
  }),
});

export type RouteSheetDto = z.infer<typeof routeSheetSchema>;
