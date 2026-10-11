import { z } from "zod";
import {
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  RECEIPT_STATUSES,
} from "../billing/allocation.js";
import { moneyInputSchema } from "./money.js";
import { paginationQuerySchema } from "./users.js";

export const manualAllocationLineSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: moneyInputSchema,
});

export const postPaymentSchema = z.object({
  subscriberId: z.string().uuid(),
  amount: moneyInputSchema,
  method: z.enum(PAYMENT_METHODS),
  receivedAt: z.string().datetime().optional(),
  referenceNumber: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
  idempotencyKey: z.string().trim().min(8).max(128),
  allocations: z.array(manualAllocationLineSchema).optional(),
});

export type PostPaymentInput = z.infer<typeof postPaymentSchema>;

export const allocationPreviewSchema = z.object({
  subscriberId: z.string().uuid(),
  amount: moneyInputSchema,
  allocations: z.array(manualAllocationLineSchema).optional(),
});

export type AllocationPreviewInput = z.infer<typeof allocationPreviewSchema>;

export const paymentListQuerySchema = paginationQuerySchema.extend({
  subscriberId: z.string().uuid().optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  status: z.enum(PAYMENT_STATUSES).optional(),
  search: z.string().trim().optional(),
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const reversePaymentSchema = z.object({
  reason: z.string().trim().min(1, "Reason is required.").max(2000),
});

export const rejectGCashSchema = z.object({
  reason: z.string().trim().min(1, "Reason is required.").max(2000),
});

export const recordGCashSchema = z.object({
  subscriberId: z.string().uuid(),
  amount: moneyInputSchema,
  referenceNumber: z.string().trim().min(1).max(120),
  senderName: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).optional(),
  idempotencyKey: z.string().trim().min(8).max(128),
});

export type RecordGCashInput = z.infer<typeof recordGCashSchema>;

export const allocationLineResponseSchema = z.object({
  invoiceId: z.string().uuid(),
  invoiceNumber: z.string(),
  allocatedCentavos: z.string(),
  previousBalanceCentavos: z.string(),
  remainingBalanceCentavos: z.string(),
  resultingStatus: z.string(),
});

export const allocationPreviewResponseSchema = z.object({
  allocations: z.array(allocationLineResponseSchema),
  totalAllocatedCentavos: z.string(),
  unallocatedCentavos: z.string(),
  openBalanceCentavos: z.string(),
});

export type AllocationPreviewResponse = z.infer<
  typeof allocationPreviewResponseSchema
>;

export const paymentListItemSchema = z.object({
  id: z.string().uuid(),
  subscriberId: z.string().uuid(),
  subscriberName: z.string(),
  subscriberAccountNumber: z.string(),
  method: z.enum(PAYMENT_METHODS),
  amountCentavos: z.string(),
  unallocatedCentavos: z.string(),
  receivedAt: z.string(),
  referenceNumber: z.string().nullable(),
  senderName: z.string().nullable(),
  status: z.enum(PAYMENT_STATUSES),
  receiptId: z.string().uuid().nullable().optional(),
  receiptNumber: z.string().nullable(),
  receiptStatus: z.enum(RECEIPT_STATUSES).nullable(),
  actorName: z.string().nullable(),
  verifiedByName: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});

export type PaymentListItem = z.infer<typeof paymentListItemSchema>;

export const paymentDetailSchema = paymentListItemSchema.extend({
  rejectionReason: z.string().nullable(),
  allocations: z.array(
    z.object({
      id: z.string().uuid(),
      invoiceId: z.string().uuid(),
      invoiceNumber: z.string(),
      amountCentavos: z.string(),
    }),
  ),
  proofs: z.array(
    z.object({
      id: z.string().uuid(),
      originalFilename: z.string(),
      mimeType: z.string(),
      sizeBytes: z.number(),
      createdAt: z.string(),
    }),
  ),
  reversal: z
    .object({
      id: z.string().uuid(),
      reason: z.string(),
      actorName: z.string().nullable(),
      createdAt: z.string(),
    })
    .nullable(),
});

export type PaymentDetail = z.infer<typeof paymentDetailSchema>;

export const receiptDetailSchema = z.object({
  id: z.string().uuid(),
  receiptNumber: z.string(),
  status: z.enum(RECEIPT_STATUSES),
  amountCentavos: z.string(),
  issuedAt: z.string(),
  voidedAt: z.string().nullable(),
  voidReason: z.string().nullable(),
  paymentId: z.string().uuid(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  referenceNumber: z.string().nullable(),
  subscriberId: z.string().uuid(),
  subscriberName: z.string(),
  subscriberAccountNumber: z.string(),
  subscriberAddress: z.string(),
  issuedByName: z.string().nullable(),
  /** Distinct plan names from allocated invoices — used as the receipt headline. */
  serviceHeadline: z.string().nullable(),
  allocations: z.array(
    z.object({
      invoiceNumber: z.string(),
      billingPeriod: z.string(),
      planName: z.string(),
      amountCentavos: z.string(),
    }),
  ),
  unallocatedCentavos: z.string(),
  remainingBalanceCentavos: z.string(),
});

export type ReceiptDetail = z.infer<typeof receiptDetailSchema>;

export const postPaymentResponseSchema = z.object({
  payment: paymentDetailSchema,
  receipt: receiptDetailSchema.nullable(),
});

export type PostPaymentResponse = z.infer<typeof postPaymentResponseSchema>;
