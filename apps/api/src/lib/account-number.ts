import { sql } from "drizzle-orm";
import { accountSequences, type Database } from "@bcis/db";

type Prefix = "SUB" | "SVC" | "INV" | "RCPT";

export async function nextAccountNumber(
  db: Pick<Database["db"], "insert" | "select" | "update">,
  prefix: Prefix,
): Promise<string> {
  const [row] = await db
    .insert(accountSequences)
    .values({ prefix, lastNumber: 1 })
    .onConflictDoUpdate({
      target: accountSequences.prefix,
      set: { lastNumber: sql`${accountSequences.lastNumber} + 1` },
    })
    .returning({ lastNumber: accountSequences.lastNumber });

  if (!row) throw new Error(`Failed to allocate ${prefix} account number`);
  return `${prefix}-${String(row.lastNumber).padStart(6, "0")}`;
}
