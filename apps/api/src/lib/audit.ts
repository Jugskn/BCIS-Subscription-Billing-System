import type { Database } from "@bcis/db";
import { auditLogs } from "@bcis/db";

export type AuditInput = {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  reason?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
};

/** Accepts the root db or a transaction client. */
export async function writeAuditLog(
  db: Pick<Database["db"], "insert">,
  input: AuditInput,
): Promise<void> {
  await db.insert(auditLogs).values({
    actorUserId: input.actorUserId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    reason: input.reason ?? null,
    oldValues: input.oldValues ?? null,
    newValues: input.newValues ?? null,
  });
}
