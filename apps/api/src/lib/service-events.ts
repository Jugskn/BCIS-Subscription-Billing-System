import { serviceEvents, type Database } from "@bcis/db";

export async function recordServiceEvent(
  db: Pick<Database["db"], "insert">,
  input: {
    serviceAccountId: string;
    eventType: string;
    oldStatus?: string | null;
    newStatus?: string | null;
    reason?: string | null;
    actorUserId?: string | null;
  },
): Promise<void> {
  await db.insert(serviceEvents).values({
    serviceAccountId: input.serviceAccountId,
    eventType: input.eventType,
    oldStatus: input.oldStatus ?? null,
    newStatus: input.newStatus ?? null,
    reason: input.reason ?? null,
    actorUserId: input.actorUserId ?? null,
  });
}
