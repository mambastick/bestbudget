CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"budget_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sent_at" timestamp with time zone,
	"status" text DEFAULT 'sending' NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_dedupe_uq" UNIQUE("user_id","channel","dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"telegram" boolean DEFAULT false NOT NULL,
	"push" boolean DEFAULT false NOT NULL,
	"due" boolean DEFAULT true NOT NULL,
	"overdue" boolean DEFAULT true NOT NULL,
	"cash_gap" boolean DEFAULT true NOT NULL,
	"budget" boolean DEFAULT true NOT NULL,
	"days_before" smallint DEFAULT 1 NOT NULL,
	"budget_threshold" smallint DEFAULT 15 NOT NULL,
	"digest" boolean DEFAULT false NOT NULL,
	"digest_time" text DEFAULT '09:00' NOT NULL,
	"quiet_start" text DEFAULT '22:00' NOT NULL,
	"quiet_end" text DEFAULT '08:00' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_id_household_id_pk" PRIMARY KEY("user_id","household_id"),
	CONSTRAINT "notification_preferences_days_ck" CHECK ("notification_preferences"."days_before" between 0 and 30),
	CONSTRAINT "notification_preferences_threshold_ck" CHECK ("notification_preferences"."budget_threshold" between 0 and 500)
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"bot_token_encrypted" text,
	"mode" text DEFAULT 'polling' NOT NULL,
	"bot_username" text,
	"bot_id" text,
	"update_offset" bigint DEFAULT 0 NOT NULL,
	"last_update_at" timestamp with time zone,
	"webhook_secret_encrypted" text,
	"transport_fingerprint" text,
	"transport_error" text,
	"vapid_public_key" text,
	"vapid_private_key_encrypted" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_settings_singleton_ck" CHECK ("notification_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_id" uuid NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "telegram_links" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"chat_id" text,
	"token_hash" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_links_chat_id_unique" UNIQUE("chat_id"),
	CONSTRAINT "telegram_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "telegram_updates" (
	"key" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_household_id_user_id_household_members_household_id_user_id_fk" FOREIGN KEY ("household_id","user_id") REFERENCES "public"."household_members"("household_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_household_id_user_id_household_members_household_id_user_id_fk" FOREIGN KEY ("household_id","user_id") REFERENCES "public"."household_members"("household_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_deliveries_created_idx" ON "notification_deliveries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");