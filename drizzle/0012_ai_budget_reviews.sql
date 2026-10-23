CREATE TABLE "ai_recommendation_proposals" (
	"household_id" uuid NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	CONSTRAINT "ai_recommendation_proposals_recommendation_id_proposal_id_pk" PRIMARY KEY("recommendation_id","proposal_id"),
	CONSTRAINT "ai_recommendation_proposals_proposal_uq" UNIQUE("household_id","proposal_id")
);
--> statement-breakpoint
CREATE TABLE "ai_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"insight" jsonb NOT NULL,
	"fingerprints" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_recommendations_household_id_uq" UNIQUE("household_id","id"),
	CONSTRAINT "ai_recommendations_status_ck" CHECK ("ai_recommendations"."status" in ('pending', 'applied', 'dismissed', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "ai_review_decisions" (
	"household_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_review_decisions_household_id_fingerprint_pk" PRIMARY KEY("household_id","fingerprint")
);
--> statement-breakpoint
CREATE TABLE "ai_review_settings" (
	"household_id" uuid PRIMARY KEY NOT NULL,
	"frequency" text DEFAULT 'off' NOT NULL,
	"weekday" smallint DEFAULT 1 NOT NULL,
	"month_day" smallint DEFAULT 1 NOT NULL,
	"time" text DEFAULT '09:00' NOT NULL,
	"telegram" boolean DEFAULT true NOT NULL,
	"push" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_review_settings_frequency_ck" CHECK ("ai_review_settings"."frequency" in ('off', 'weekly', 'monthly')),
	CONSTRAINT "ai_review_settings_day_ck" CHECK ("ai_review_settings"."weekday" between 1 and 7 and "ai_review_settings"."month_day" between 1 and 31),
	CONSTRAINT "ai_review_settings_time_ck" CHECK ("ai_review_settings"."time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
CREATE TABLE "ai_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"conversation_id" uuid,
	"source_fingerprint" text NOT NULL,
	"output" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ai_reviews_period_uq" UNIQUE("household_id","period_key"),
	CONSTRAINT "ai_reviews_household_id_uq" UNIQUE("household_id","id"),
	CONSTRAINT "ai_reviews_status_ck" CHECK ("ai_reviews"."status" in ('running', 'completed', 'quota_skipped', 'failed', 'interrupted', 'disabled'))
);
--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD COLUMN "author" text DEFAULT 'assistant' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "ai_review" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "review_email" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_household_id_uq" UNIQUE("household_id","id");--> statement-breakpoint
ALTER TABLE "ai_recommendation_proposals" ADD CONSTRAINT "ai_recommendation_proposals_household_id_recommendation_id_ai_recommendations_household_id_id_fk" FOREIGN KEY ("household_id","recommendation_id") REFERENCES "public"."ai_recommendations"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_recommendation_proposals" ADD CONSTRAINT "ai_recommendation_proposals_household_id_proposal_id_ai_proposals_household_id_id_fk" FOREIGN KEY ("household_id","proposal_id") REFERENCES "public"."ai_proposals"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_household_id_review_id_ai_reviews_household_id_id_fk" FOREIGN KEY ("household_id","review_id") REFERENCES "public"."ai_reviews"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_decisions" ADD CONSTRAINT "ai_review_decisions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_decisions" ADD CONSTRAINT "ai_review_decisions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_settings" ADD CONSTRAINT "ai_review_settings_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_reviews" ADD CONSTRAINT "ai_reviews_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_reviews" ADD CONSTRAINT "ai_reviews_household_id_conversation_id_ai_conversations_household_id_id_fk" FOREIGN KEY ("household_id","conversation_id") REFERENCES "public"."ai_conversations"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_recommendations_status_idx" ON "ai_recommendations" USING btree ("household_id","status");--> statement-breakpoint
CREATE INDEX "ai_reviews_created_idx" ON "ai_reviews" USING btree ("household_id","created_at");
