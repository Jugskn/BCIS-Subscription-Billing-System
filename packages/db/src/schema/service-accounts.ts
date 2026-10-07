import {
  bigint,
  date,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { servicePlans } from "./services.js";
import { subscribers } from "./subscribers.js";

export const serviceAccountStatusEnum = pgEnum("service_account_status", [
  "ACTIVE",
  "SUSPENDED",
  "TERMINATED",
  "ARCHIVED",
]);

export const serviceAccounts = pgTable("service_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountNumber: text("account_number").notNull().unique(),
  subscriberId: uuid("subscriber_id")
    .notNull()
    .references(() => subscribers.id),
  servicePlanId: uuid("service_plan_id")
    .notNull()
    .references(() => servicePlans.id),
  installationAddress: text("installation_address").notNull(),
  activationDate: date("activation_date").notNull(),
  billingStartDate: date("billing_start_date").notNull(),
  dueDay: integer("due_day").notNull(),
  currentRateCentavos: bigint("current_rate_centavos", { mode: "bigint" }).notNull(),
  status: serviceAccountStatusEnum("status").notNull().default("ACTIVE"),
  collectorUserId: uuid("collector_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const serviceEvents = pgTable("service_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  serviceAccountId: uuid("service_account_id")
    .notNull()
    .references(() => serviceAccounts.id),
  eventType: text("event_type").notNull(),
  oldStatus: text("old_status"),
  newStatus: text("new_status"),
  reason: text("reason"),
  actorUserId: uuid("actor_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ServiceAccount = typeof serviceAccounts.$inferSelect;
export type NewServiceAccount = typeof serviceAccounts.$inferInsert;
export type ServiceEvent = typeof serviceEvents.$inferSelect;
export type NewServiceEvent = typeof serviceEvents.$inferInsert;
