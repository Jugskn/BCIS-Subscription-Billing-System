import { sql } from "drizzle-orm";
import { accountSequences, type Database } from "@bcis/db";

type Db = Pick<Database["db"], "insert" | "select" | "update">;

const PREFIX_RE = /^[A-Z0-9]{1,12}$/;

/** Allocate next number for a document/account prefix (locked counter row). */
export async function nextAccountNumber(
  db: Db,
  prefix: string,
): Promise<string> {
  const normalized = prefix.trim().toUpperCase();
  if (!PREFIX_RE.test(normalized)) {
    throw new Error(`Invalid account number prefix: ${prefix}`);
  }

  const [row] = await db
    .insert(accountSequences)
    .values({ prefix: normalized, lastNumber: 1 })
    .onConflictDoUpdate({
      target: accountSequences.prefix,
      set: { lastNumber: sql`${accountSequences.lastNumber} + 1` },
    })
    .returning({ lastNumber: accountSequences.lastNumber });

  if (!row) throw new Error(`Failed to allocate ${normalized} account number`);
  return `${normalized}-${String(row.lastNumber).padStart(6, "0")}`;
}
