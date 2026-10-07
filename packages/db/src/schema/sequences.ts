import { integer, pgTable, text } from "drizzle-orm/pg-core";

/** Locked counter rows for auto-generated account numbers. */
export const accountSequences = pgTable("account_sequences", {
  prefix: text("prefix").primaryKey(),
  lastNumber: integer("last_number").notNull().default(0),
});

export type AccountSequence = typeof accountSequences.$inferSelect;
