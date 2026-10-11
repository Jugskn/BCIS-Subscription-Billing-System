import {
  boolean,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const collectionAreas = pgTable("collection_areas", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const collectorAssignments = pgTable("collector_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  collectorUserId: uuid("collector_user_id")
    .notNull()
    .references(() => users.id),
  collectionAreaId: uuid("collection_area_id")
    .notNull()
    .references(() => collectionAreas.id),
  isActive: boolean("is_active").notNull().default(true),
  assignedAt: timestamp("assigned_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type CollectionArea = typeof collectionAreas.$inferSelect;
export type NewCollectionArea = typeof collectionAreas.$inferInsert;
export type CollectorAssignment = typeof collectorAssignments.$inferSelect;
