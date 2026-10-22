CREATE TYPE "public"."goal_kind" AS ENUM('account', 'manual');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('active', 'achieved', 'archived');--> statement-breakpoint
CREATE TABLE "goal_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount" bigint NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_contributions_amount_ck" CHECK ("goal_contributions"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"icon" text DEFAULT 'piggy-bank' NOT NULL,
	"color" text DEFAULT '#10b981' NOT NULL,
	"target_amount" bigint NOT NULL,
	"currency" text DEFAULT 'RUB' NOT NULL,
	"target_date" date,
	"kind" "goal_kind" NOT NULL,
	"account_id" uuid,
	"allocated_amount" bigint,
	"expense_months" smallint,
	"expense_window" smallint DEFAULT 3 NOT NULL,
	"status" "goal_status" DEFAULT 'active' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_household_id_uq" UNIQUE("household_id","id"),
	CONSTRAINT "goals_account_ck" CHECK (("goals"."kind" = 'account') = ("goals"."account_id" is not null)),
	CONSTRAINT "goals_amount_ck" CHECK ("goals"."target_amount" > 0 and ("goals"."allocated_amount" is null or ("goals"."kind" = 'account' and "goals"."allocated_amount" > 0))),
	CONSTRAINT "goals_expenses_ck" CHECK (("goals"."expense_months" is null or "goals"."expense_months" between 1 and 60) and "goals"."expense_window" in (3, 6))
);
--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD COLUMN "goal_id" uuid;--> statement-breakpoint
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_goal_fk" FOREIGN KEY ("household_id","goal_id") REFERENCES "public"."goals"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_account_fk" FOREIGN KEY ("household_id","account_id") REFERENCES "public"."financial_accounts"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goal_contributions_goal_idx" ON "goal_contributions" USING btree ("household_id","goal_id","date");--> statement-breakpoint
CREATE INDEX "goals_household_idx" ON "goals" USING btree ("household_id","status","priority");--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_goal_fk" FOREIGN KEY ("household_id","goal_id") REFERENCES "public"."goals"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_rules_goal_uq" ON "recurring_rules" USING btree ("goal_id") WHERE "recurring_rules"."goal_id" is not null;