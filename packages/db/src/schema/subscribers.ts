import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { collectionAreas } from "./collections.js";

export const subscriberStatusEnum = pgEnum("subscriber_status", [
  "ACTIVE",
  "INACTIVE",
  "TERMINATED",
  "ARCHIVED",
]);

export const subscribers = pgTable("subscribers", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountNumber: text("account_number").notNull().unique(),
  fullName: text("full_name").notNull(),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  address: text("address").notNull(),
  collectionAreaId: uuid("collection_area_id").references(
    () => collectionAreas.id,
  ),
  collectorUserId: uuid("collector_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  dueDay: integer("due_day").notNull(),
  status: subscriberStatusEnum("status").notNull().default("ACTIVE"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Subscriber = typeof subscribers.$inferSelect;
export type NewSubscriber = typeof subscribers.$inferInsert;
