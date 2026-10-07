import {
  bigint,
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const serviceTypes = pgTable("service_types", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const servicePlans = pgTable("service_plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  serviceTypeId: uuid("service_type_id")
    .notNull()
    .references(() => serviceTypes.id),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  priceCentavos: bigint("price_centavos", { mode: "bigint" }).notNull(),
  installationFeeCentavos: bigint("installation_fee_centavos", {
    mode: "bigint",
  })
    .notNull()
    .default(0n),
  speedMbps: integer("speed_mbps"),
  channelCount: integer("channel_count"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ServiceType = typeof serviceTypes.$inferSelect;
export type NewServiceType = typeof serviceTypes.$inferInsert;
export type ServicePlan = typeof servicePlans.$inferSelect;
export type NewServicePlan = typeof servicePlans.$inferInsert;
