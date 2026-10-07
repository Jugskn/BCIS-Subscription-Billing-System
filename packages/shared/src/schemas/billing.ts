import { z } from "zod";
import { INVOICE_STATUSES } from "../billing/invoice.js";
import { paginationQuerySchema } from "./users.js";
import { moneyInputSchema } from "./money.js";

export const billingPeriodSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Billing period must be YYYY-MM.");

export const generateBillingPreviewSchema = z.object({
  billingPeriod: billingPeriodSchema,
});

export const generateBillingConfirmSchema = z.object({
  billingPeriod: billingPeriodSchema,
});

export const voidInvoiceSchema = z.object({
  reason: z.string().trim().min(1, "Reason is required."),
});

export const adjustInvoiceSchema = z.object({
  amount: moneyInputSchema,
  reason: z.string().trim().min(1, "Reason is required."),
});

export const invoiceListQuerySchema = paginationQuerySchema.extend({
  billingPeriod: billingPeriodSchema.optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  subscriberId: z.string().uuid().optional(),
  serviceAccountId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
});

export const ledgerQuerySchema = paginationQuerySchema.extend({
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const statementQuerySchema = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const invoiceItemSchema = z.object({
  id: z.string().uuid(),
  itemType: z.string(),
  description: z.string(),
  rateCentavos: z.string(),
  quantity: z.number(),
  amountCentavos: z.string(),
});

export const invoiceListItemSchema = z.object({
  id: z.string().uuid(),
  invoiceNumber: z.string(),
  billingPeriod: z.string(),
  subscriberId: z.string().uuid(),
  subscriberName: z.string(),
  subscriberAccountNumber: z.string(),
  serviceAccountNumber: z.string(),
  status: z.enum(INVOICE_STATUSES),
  dueDate: z.string(),
  totalCentavos: z.string(),
  paidCentavos: z.string(),
  balanceCentavos: z.string(),
  issuedAt: z.string(),
});

export type InvoiceListItem = z.infer<typeof invoiceListItemSchema>;

export const invoiceDetailSchema = invoiceListItemSchema.extend({
  serviceAccountId: z.string().uuid(),
  subtotalCentavos: z.string(),
  discountCentavos: z.string(),
  penaltyCentavos: z.string(),
  adjustmentCentavos: z.string(),
  creditAppliedCentavos: z.string(),
  voidReason: z.string().nullable(),
  voidedAt: z.string().nullable(),
  items: z.array(invoiceItemSchema),
});

export type InvoiceDetail = z.infer<typeof invoiceDetailSchema>;

export const billingPreviewSchema = z.object({
  billingPeriod: z.string(),
  dueDate: z.string(),
  eligibleCount: z.number(),
  estimatedTotalCentavos: z.string(),
  accounts: z.array(
    z.object({
      serviceAccountId: z.string().uuid(),
      accountNumber: z.string(),
      subscriberName: z.string(),
      collectionAreaId: z.string().uuid().nullable(),
      rateCentavos: z.string(),
      dueDay: z.number(),
      alreadyBilled: z.boolean(),
    }),
  ),
});

export type BillingPreview = z.infer<typeof billingPreviewSchema>;

export const billingCycleSchema = z.object({
  id: z.string().uuid(),
  billingPeriod: z.string(),
  status: z.string(),
  generatedAt: z.string().nullable(),
  invoiceCount: z.number(),
  totalCentavos: z.string(),
});

export type BillingCycleSummary = z.infer<typeof billingCycleSchema>;

export const ledgerEntrySchema = z.object({
  id: z.string().uuid(),
  entryDate: z.string(),
  referenceType: z.string(),
  referenceId: z.string().uuid(),
  description: z.string(),
  debitCentavos: z.string(),
  creditCentavos: z.string(),
  balanceCentavos: z.string(),
  serviceAccountId: z.string().uuid().nullable(),
});

export type LedgerEntryItem = z.infer<typeof ledgerEntrySchema>;

export const statementOfAccountSchema = z.object({
  subscriberId: z.string().uuid(),
  subscriberName: z.string(),
  accountNumber: z.string(),
  fromDate: z.string(),
  toDate: z.string(),
  openingBalanceCentavos: z.string(),
  closingBalanceCentavos: z.string(),
  entries: z.array(ledgerEntrySchema),
});

export type StatementOfAccount = z.infer<typeof statementOfAccountSchema>;
