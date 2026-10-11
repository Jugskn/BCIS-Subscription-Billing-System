import { z } from "zod";

/** Options endpoints: search only, no pagination (server caps at 50). */
export const optionsSearchQuerySchema = z.object({
  search: z.string().trim().optional(),
});

export type OptionsSearchQuery = z.infer<typeof optionsSearchQuerySchema>;

export const OPTIONS_LIMIT = 50;

export const subscriberOptionSchema = z.object({
  id: z.string().uuid(),
  accountNumber: z.string(),
  fullName: z.string(),
});

export type SubscriberOption = z.infer<typeof subscriberOptionSchema>;

export const planOptionSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  priceCentavos: z.string(),
});

export type PlanOption = z.infer<typeof planOptionSchema>;

export const areaOptionSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
});

export type AreaOption = z.infer<typeof areaOptionSchema>;

export const collectorOptionSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  username: z.string(),
});

export type CollectorOption = z.infer<typeof collectorOptionSchema>;

export const technicianOptionSchema = collectorOptionSchema;
export type TechnicianOption = z.infer<typeof technicianOptionSchema>;

export const approverOptionSchema = collectorOptionSchema;
export type ApproverOption = z.infer<typeof approverOptionSchema>;
