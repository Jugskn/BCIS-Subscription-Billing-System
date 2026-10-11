import { z } from "zod";

export const restoreBackupSchema = z.object({
  backupId: z.string().min(1),
  confirmation: z.literal("RESTORE"),
});

export type RestoreBackupInput = z.infer<typeof restoreBackupSchema>;

export const backupListItemSchema = z.object({
  id: z.string(),
  folderName: z.string(),
  path: z.string(),
  createdAt: z.string(),
  sizeBytes: z.string(),
  verified: z.boolean(),
  checksumSha256: z.string().nullable(),
  status: z.string(),
  dbName: z.string().nullable(),
  appVersion: z.string().nullable(),
});

export type BackupListItem = z.infer<typeof backupListItemSchema>;
