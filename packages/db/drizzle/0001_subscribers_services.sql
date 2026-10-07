CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE "public"."subscriber_status" AS ENUM('ACTIVE', 'INACTIVE', 'TERMINATED', 'ARCHIVED');
CREATE TYPE "public"."service_account_status" AS ENUM('ACTIVE', 'SUSPENDED', 'TERMINATED', 'ARCHIVED');

CREATE TABLE IF NOT EXISTS "service_types" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "service_types_code_unique" UNIQUE("code")
);

CREATE TABLE IF NOT EXISTS "service_plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "service_type_id" uuid NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "price_centavos" bigint NOT NULL,
  "installation_fee_centavos" bigint DEFAULT 0 NOT NULL,
  "speed_mbps" integer,
  "channel_count" integer,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "service_plans_code_unique" UNIQUE("code")
);

CREATE TABLE IF NOT EXISTS "collection_areas" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "collection_areas_code_unique" UNIQUE("code")
);

CREATE TABLE IF NOT EXISTS "account_sequences" (
  "prefix" text PRIMARY KEY NOT NULL,
  "last_number" integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS "subscribers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_number" text NOT NULL,
  "full_name" text NOT NULL,
  "contact_phone" text,
  "contact_email" text,
  "address" text NOT NULL,
  "collection_area_id" uuid,
  "collector_user_id" uuid,
  "due_day" integer NOT NULL,
  "status" "subscriber_status" DEFAULT 'ACTIVE' NOT NULL,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "subscribers_account_number_unique" UNIQUE("account_number")
);

CREATE TABLE IF NOT EXISTS "service_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_number" text NOT NULL,
  "subscriber_id" uuid NOT NULL,
  "service_plan_id" uuid NOT NULL,
  "installation_address" text NOT NULL,
  "activation_date" date NOT NULL,
  "billing_start_date" date NOT NULL,
  "due_day" integer NOT NULL,
  "current_rate_centavos" bigint NOT NULL,
  "status" "service_account_status" DEFAULT 'ACTIVE' NOT NULL,
  "collector_user_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "service_accounts_account_number_unique" UNIQUE("account_number")
);

CREATE TABLE IF NOT EXISTS "service_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "service_account_id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "old_status" text,
  "new_status" text,
  "reason" text,
  "actor_user_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE "service_plans"
  ADD CONSTRAINT "service_plans_service_type_id_service_types_id_fk"
  FOREIGN KEY ("service_type_id") REFERENCES "public"."service_types"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "subscribers"
  ADD CONSTRAINT "subscribers_collection_area_id_collection_areas_id_fk"
  FOREIGN KEY ("collection_area_id") REFERENCES "public"."collection_areas"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "subscribers"
  ADD CONSTRAINT "subscribers_collector_user_id_users_id_fk"
  FOREIGN KEY ("collector_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "service_accounts"
  ADD CONSTRAINT "service_accounts_subscriber_id_subscribers_id_fk"
  FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "service_accounts"
  ADD CONSTRAINT "service_accounts_service_plan_id_service_plans_id_fk"
  FOREIGN KEY ("service_plan_id") REFERENCES "public"."service_plans"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "service_accounts"
  ADD CONSTRAINT "service_accounts_collector_user_id_users_id_fk"
  FOREIGN KEY ("collector_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "service_events"
  ADD CONSTRAINT "service_events_service_account_id_service_accounts_id_fk"
  FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "service_events"
  ADD CONSTRAINT "service_events_actor_user_id_users_id_fk"
  FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

INSERT INTO "account_sequences" ("prefix", "last_number") VALUES ('SUB', 0), ('SVC', 0)
ON CONFLICT ("prefix") DO NOTHING;

CREATE INDEX IF NOT EXISTS "subscribers_account_number_trgm_idx"
  ON "subscribers" USING gin ("account_number" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "subscribers_full_name_trgm_idx"
  ON "subscribers" USING gin ("full_name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "subscribers_contact_phone_trgm_idx"
  ON "subscribers" USING gin ("contact_phone" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "subscribers_address_trgm_idx"
  ON "subscribers" USING gin ("address" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "subscribers_status_idx" ON "subscribers" ("status");
CREATE INDEX IF NOT EXISTS "subscribers_collection_area_idx" ON "subscribers" ("collection_area_id");
CREATE INDEX IF NOT EXISTS "service_accounts_subscriber_idx" ON "service_accounts" ("subscriber_id");
CREATE INDEX IF NOT EXISTS "service_accounts_status_idx" ON "service_accounts" ("status");
CREATE INDEX IF NOT EXISTS "service_events_service_account_idx" ON "service_events" ("service_account_id");
