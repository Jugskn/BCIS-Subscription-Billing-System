import { z } from "zod";
import { paginationQuerySchema } from "./users.js";

export const SUBSCRIBER_STATUSES = [
  "ACTIVE",
  "INACTIVE",
  "TERMINATED",
  "ARCHIVED",
] as const;

export const SERVICE_ACCOUNT_STATUSES = [
  "ACTIVE",
  "SUSPENDED",
  "TERMINATED",
  "ARCHIVED",
] as const;

export type SubscriberStatus = (typeof SUBSCRIBER_STATUSES)[number];
export type ServiceAccountStatus = (typeof SERVICE_ACCOUNT_STATUSES)[number];

const dueDaySchema = z.coerce.number().int().min(1).max(28);

export function normalizePhilippineMobile(value: string): string {
  const compact = value.trim().replace(/[\s()-]/g, "");
  if (/^09\d{9}$/.test(compact)) return `+63${compact.slice(1)}`;
  return compact;
}

export function formatPhilippineMobile(value: string | null | undefined): string {
  if (!value) return "";
  const normalized = normalizePhilippineMobile(value);
  const match = normalized.match(/^\+63(9\d{2})(\d{3})(\d{4})$/);
  return match ? `+63 ${match[1]} ${match[2]} ${match[3]}` : value;
}

export const philippineMobileSchema = z
  .string()
  .trim()
  .transform(normalizePhilippineMobile)
  .refine(
    (value) => /^\+639\d{9}$/.test(value),
    "Enter a valid Philippine mobile number (09XX XXX XXXX or +63 9XX XXX XXXX).",
  );

const optionalPhilippineMobileSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  philippineMobileSchema.optional(),
);

export const createSubscriberSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required."),
  contactPhone: optionalPhilippineMobileSchema,
  contactEmail: z.string().trim().email().optional().or(z.literal("")),
  address: z.string().trim().min(1, "Address is required."),
  collectionAreaId: z.string().uuid().optional().nullable(),
  collectorUserId: z.string().uuid().optional().nullable(),
  dueDay: dueDaySchema,
  notes: z.string().trim().optional(),
  /** Active service plans to subscribe; each creates a service account on save. */
  servicePlanIds: z.array(z.string().uuid()).default([]),
});

export type CreateSubscriberInput = z.infer<typeof createSubscriberSchema>;

export const updateSubscriberSchema = createSubscriberSchema
  .omit({ servicePlanIds: true })
  .partial()
  .extend({
    status: z.enum(SUBSCRIBER_STATUSES).optional(),
    statusReason: z.string().trim().optional(),
  });

export type UpdateSubscriberInput = z.infer<typeof updateSubscriberSchema>;

export const subscriberListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(SUBSCRIBER_STATUSES).optional(),
  collectionAreaId: z.string().uuid().optional(),
});

export const globalSearchQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1, "Search query is required."),
});

export const subscriberListItemSchema = z.object({
  id: z.string().uuid(),
  accountNumber: z.string(),
  fullName: z.string(),
  contactPhone: z.string().nullable(),
  address: z.string(),
  collectionAreaName: z.string().nullable(),
  collectorName: z.string().nullable(),
  dueDay: z.number(),
  status: z.enum(SUBSCRIBER_STATUSES),
  createdAt: z.string(),
});

export type SubscriberListItem = z.infer<typeof subscriberListItemSchema>;

export const subscriberDetailSchema = subscriberListItemSchema.extend({
  contactEmail: z.string().nullable(),
  collectionAreaId: z.string().uuid().nullable(),
  collectorUserId: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  updatedAt: z.string(),
});

export type SubscriberDetail = z.infer<typeof subscriberDetailSchema>;

export const createServiceAccountSchema = z.object({
  subscriberId: z.string().uuid(),
  servicePlanId: z.string().uuid(),
  installationAddress: z.string().trim().min(1),
  activationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  billingStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDay: dueDaySchema,
  collectorUserId: z.string().uuid().optional().nullable(),
});

export type CreateServiceAccountInput = z.infer<typeof createServiceAccountSchema>;

export const updateServiceAccountSchema = z.object({
  installationAddress: z.string().trim().min(1).optional(),
  dueDay: dueDaySchema.optional(),
  collectorUserId: z.string().uuid().optional().nullable(),
  status: z.enum(SERVICE_ACCOUNT_STATUSES).optional(),
  statusReason: z.string().trim().optional(),
});

export type UpdateServiceAccountInput = z.infer<typeof updateServiceAccountSchema>;

export const serviceAccountListQuerySchema = paginationQuerySchema.extend({
  subscriberId: z.string().uuid().optional(),
  status: z.enum(SERVICE_ACCOUNT_STATUSES).optional(),
  servicePlanId: z.string().uuid().optional(),
});

export const serviceAccountListItemSchema = z.object({
  id: z.string().uuid(),
  accountNumber: z.string(),
  subscriberId: z.string().uuid(),
  subscriberName: z.string(),
  subscriberAccountNumber: z.string(),
  planCode: z.string(),
  planName: z.string(),
  serviceTypeName: z.string(),
  installationAddress: z.string(),
  currentRateCentavos: z.string(),
  dueDay: z.number(),
  status: z.enum(SERVICE_ACCOUNT_STATUSES),
  activationDate: z.string(),
  createdAt: z.string(),
});

export type ServiceAccountListItem = z.infer<typeof serviceAccountListItemSchema>;

export const serviceEventSchema = z.object({
  id: z.string().uuid(),
  eventType: z.string(),
  oldStatus: z.string().nullable(),
  newStatus: z.string().nullable(),
  reason: z.string().nullable(),
  actorName: z.string().nullable(),
  createdAt: z.string(),
});

export type ServiceEventItem = z.infer<typeof serviceEventSchema>;
