import { eq } from "drizzle-orm";
import { applicationSettings, type Database } from "@bcis/db";

type DbReader = Pick<Database["db"], "select">;

export async function getGraceDays(db: DbReader): Promise<number> {
  const [row] = await db
    .select()
    .from(applicationSettings)
    .where(eq(applicationSettings.key, "grace_days"))
    .limit(1);
  const value = row?.value;
  if (typeof value === "number" && Number.isInteger(value)) return value;
  return 5;
}

export async function getPenaltiesEnabled(db: DbReader): Promise<boolean> {
  const [row] = await db
    .select()
    .from(applicationSettings)
    .where(eq(applicationSettings.key, "penalties_enabled"))
    .limit(1);
  return row?.value === true;
}
