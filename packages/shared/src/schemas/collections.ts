import { z } from "zod";
import { paginationQuerySchema } from "./users.js";

/**
 * Optional free text: "" and null → null.
 * Omitted (undefined) stays undefined so partial updates do not clear the field.
 */
export const optionalNullableText = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((v) =>
    v === undefined ? undefined : v === null || v === "" ? null : v,
  );

export const createCollectionAreaSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[A-Z0-9_-]+$/i),
  name: z.string().trim().min(1),
  description: optionalNullableText,
  isActive: z.boolean().optional(),
});

export type CreateCollectionAreaInput = z.infer<typeof createCollectionAreaSchema>;

export const updateCollectionAreaSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[A-Z0-9_-]+$/i)
    .optional(),
  name: z.string().trim().min(1).optional(),
  description: optionalNullableText,
  isActive: z.boolean().optional(),
});

export type UpdateCollectionAreaInput = z.infer<typeof updateCollectionAreaSchema>;

export const collectionAreaListQuerySchema = paginationQuerySchema.extend({
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});

export const collectionAreaListItemSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
});

export type CollectionAreaListItem = z.infer<typeof collectionAreaListItemSchema>;
