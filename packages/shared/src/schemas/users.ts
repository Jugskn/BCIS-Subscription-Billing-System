import { z } from "zod";
import { ROLES } from "../permissions.js";

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, "Username may contain letters, numbers, . _ -"),
  password: z.string().min(8).max(256),
  fullName: z.string().trim().min(1).max(120),
  roleNames: z.array(z.enum(ROLES)).min(1),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const assignRolesSchema = z.object({
  roleNames: z.array(z.enum(ROLES)).min(1),
});

export type AssignRolesInput = z.infer<typeof assignRolesSchema>;

export const userListItemSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  fullName: z.string(),
  isActive: z.boolean(),
  roles: z.array(z.string()),
  createdAt: z.string(),
});

export type UserListItem = z.infer<typeof userListItemSchema>;
