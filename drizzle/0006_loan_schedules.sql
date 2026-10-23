CREATE TYPE "public"."loan_event_type" AS ENUM('prepayment', 'rate_change', 'reconciliation');--> statement-breakpoint
CREATE TYPE "public"."loan_interest_method" AS ENUM('monthly', 'daily_365', 'daily_actual');--> statement-breakpoint
CREATE TYPE "public"."loan_kind" AS ENUM('mortgage', 'consumer', 'car', 'credit_line', 'other');--> statement-breakpoint
CREATE TYPE "public"."loan_prepayment_mode" AS ENUM('reduce_term', 'reduce_payment');--> statement-breakpoint
CREATE TYPE "public"."loan_schedule_type" AS ENUM('annuity', 'differentiated');--> statement-breakpoint
CREATE TYPE "public"."loan_status" AS ENUM('active', 'closed');--> statement-breakpoint
ALTER TYPE "public"."financial_account_kind" ADD VALUE 'loan';--> statement-breakpoint
CREATE TABLE "loan_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"loan_id" uuid NOT NULL,
	"type" "loan_event_type" NOT NULL,
	"date" date NOT NULL,
	"amount" bigint,
	"mode" "loan_prepayment_mode",
	"annual_rate" numeric(9, 6),
	"balance" bigint,
	"balance_delta" bigint,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loan_events_date_uq" UNIQUE("loan_id","date"),
	CONSTRAINT "loan_events_payload_ck" CHECK ((
    "loan_events"."type" = 'prepayment' and "loan_events"."amount" is not null and "loan_events"."amount" > 0 and "loan_events"."mode" is not null and "loan_events"."annual_rate" is null and "loan_events"."balance" is null and "loan_events"."balance_delta" is null
  ) or (
    "loan_events"."type" = 'rate_change' and "loan_events"."annual_rate" is not null and "loan_events"."annual_rate" between 0 and 100 and "loan_events"."amount" is null and "loan_events"."mode" is null and "loan_events"."balance" is null and "loan_events"."balance_delta" is null
  ) or (
    "loan_events"."type" = 'reconciliation' and "loan_events"."balance" is not null and "loan_events"."balance" >= 0 and "loan_events"."balance_delta" is not null and "loan_events"."amount" is null and "loan_events"."mode" is null and "loan_events"."annual_rate" is null
  ))
);
--> statement-breakpoint
CREATE TABLE "loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"lender" text NOT NULL,
	"kind" "loan_kind" NOT NULL,
	"principal" bigint NOT NULL,
	"annual_rate" numeric(9, 6) NOT NULL,
	"start_date" date NOT NULL,
	"tracking_date" date NOT NULL,
	"tracking_balance" bigint NOT NULL,
	"first_payment_date" date NOT NULL,
	"term_months" integer NOT NULL,
	"payment_day" smallint NOT NULL,
	"payment_amount" bigint,
	"schedule_type" "loan_schedule_type" NOT NULL,
	"interest_method" "loan_interest_method" NOT NULL,
	"payment_account_id" uuid NOT NULL,
	"interest_category_id" uuid NOT NULL,
	"status" "loan_status" DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loans_household_id_uq" UNIQUE("household_id","id"),
	CONSTRAINT "loans_account_uq" UNIQUE("account_id"),
	CONSTRAINT "loans_amounts_ck" CHECK ("loans"."principal" > 0 and "loans"."tracking_balance" > 0 and "loans"."tracking_balance" <= "loans"."principal" and ("loans"."payment_amount" is null or "loans"."payment_amount" > 0)),
	CONSTRAINT "loans_rate_ck" CHECK ("loans"."annual_rate" between 0 and 100),
	CONSTRAINT "loans_term_ck" CHECK ("loans"."term_months" between 1 and 600 and "loans"."payment_day" between 1 and 31),
	CONSTRAINT "loans_dates_ck" CHECK ("loans"."start_date" <= "loans"."tracking_date" and "loans"."first_payment_date" > "loans"."tracking_date"),
	CONSTRAINT "loans_accounts_ck" CHECK ("loans"."account_id" <> "loans"."payment_account_id")
);
--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD COLUMN "credit_limit" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "loan_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "loan_due_date" date;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "loan_part" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "loan_payment_key" text;--> statement-breakpoint
ALTER TABLE "loan_events" ADD CONSTRAINT "loan_events_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_events" ADD CONSTRAINT "loan_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_events" ADD CONSTRAINT "loan_events_loan_fk" FOREIGN KEY ("household_id","loan_id") REFERENCES "public"."loans"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_account_fk" FOREIGN KEY ("household_id","account_id") REFERENCES "public"."financial_accounts"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_payment_account_fk" FOREIGN KEY ("household_id","payment_account_id") REFERENCES "public"."financial_accounts"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_interest_category_fk" FOREIGN KEY ("household_id","interest_category_id") REFERENCES "public"."categories"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loans_household_idx" ON "loans" USING btree ("household_id");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_loan_fk" FOREIGN KEY ("household_id","loan_id") REFERENCES "public"."loans"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_loan_payment_key_idx" ON "transactions" USING btree ("household_id","loan_payment_key");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_loan_part_uq" UNIQUE("loan_id","loan_due_date","loan_part");--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_credit_limit_ck" CHECK ("financial_accounts"."credit_limit" >= 0);--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_loan_ck" CHECK (("transactions"."loan_id" is null and "transactions"."loan_due_date" is null and "transactions"."loan_part" is null and "transactions"."loan_payment_key" is null) or ("transactions"."loan_id" is not null and "transactions"."loan_due_date" is not null and "transactions"."loan_payment_key" is not null and "transactions"."loan_part" is not null and "transactions"."recurring_rule_id" is null and (("transactions"."loan_part" = 'interest' and "transactions"."type" = 'expense') or ("transactions"."loan_part" in ('principal', 'prepayment') and "transactions"."type" = 'transfer'))));