import { z } from "zod";

export const loginRequestSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const sessionUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  fullName: z.string(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
});

export type SessionUser = z.infer<typeof sessionUserSchema>;

export const loginResponseSchema = z.object({
  token: z.string(),
  user: sessionUserSchema,
  sessionTimeoutMinutes: z.number().int().positive().optional(),
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;
