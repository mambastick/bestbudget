CREATE TYPE "public"."loan_holiday_interest" AS ENUM('deferred_spread', 'deferred_end', 'capitalize', 'waived');--> statement-breakpoint
CREATE TYPE "public"."loan_holiday_mode" AS ENUM('no_payment', 'interest_only');--> statement-breakpoint
CREATE TYPE "public"."loan_holiday_shift" AS ENUM('extend_term', 'keep_term');--> statement-breakpoint
ALTER TABLE "loan_events" DROP CONSTRAINT "loan_events_date_uq";--> statement-breakpoint
ALTER TABLE "loan_events" DROP CONSTRAINT "loan_events_payload_ck";--> statement-breakpoint
-- Pending migrations share one transaction, where a value added by ALTER TYPE ... ADD VALUE cannot be used yet.
ALTER TABLE "loan_events" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."loan_event_type";--> statement-breakpoint
CREATE TYPE "public"."loan_event_type" AS ENUM('prepayment', 'rate_change', 'reconciliation', 'correction', 'restructuring', 'holiday');--> statement-breakpoint
ALTER TABLE "loan_events" ALTER COLUMN "type" SET DATA TYPE "public"."loan_event_type" USING "type"::"public"."loan_event_type";--> statement-breakpoint
ALTER TABLE "loan_events" ADD COLUMN "next_payment_date" date;--> statement-breakpoint
ALTER TABLE "loan_events" ADD COLUMN "payment_day" smallint;--> statement-breakpoint
ALTER TABLE "loan_events" ADD COLUMN "term_months" integer;--> statement-breakpoint
ALTER TABLE "loan_events" ADD COLUMN "payment_amount" bigint;--> statement-breakpoint
ALTER TABLE "loan_events" ADD COLUMN "schedule_type" "loan_schedule_type";--> statement-breakpoint
ALTER TABLE "loan_events" ADD COLUMN "interest_method" "loan_interest_method";--> statement-breakpoint
ALTER TABLE "loan_events" ADD COLUMN "end_date" date;--> statement-breakpoint
ALTER TABLE "loan_events" ADD COLUMN "holiday_mode" "loan_holiday_mode";--> statement-breakpoint
ALTER TABLE "loan_events" ADD COLUMN "holiday_interest" "loan_holiday_interest";--> statement-breakpoint
ALTER TABLE "loan_events" ADD COLUMN "holiday_shift" "loan_holiday_shift";--> statement-breakpoint
ALTER TABLE "loan_events" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "loan_events" ADD COLUMN "terms" jsonb;--> statement-breakpoint
ALTER TABLE "loan_events" ADD CONSTRAINT "loan_events_date_type_uq" UNIQUE("loan_id","date","type");--> statement-breakpoint
ALTER TABLE "loan_events" ADD CONSTRAINT "loan_events_payload_ck" CHECK ((
      "loan_events"."type" = 'prepayment' and "loan_events"."amount" is not null and "loan_events"."amount" > 0 and "loan_events"."mode" is not null and "loan_events"."annual_rate" is null and "loan_events"."balance" is null and "loan_events"."balance_delta" is null and "loan_events"."next_payment_date" is null and "loan_events"."payment_day" is null and "loan_events"."term_months" is null and "loan_events"."payment_amount" is null and "loan_events"."schedule_type" is null and "loan_events"."interest_method" is null and "loan_events"."end_date" is null and "loan_events"."holiday_mode" is null and "loan_events"."holiday_interest" is null and "loan_events"."holiday_shift" is null
    ) or (
      "loan_events"."type" = 'rate_change' and "loan_events"."annual_rate" is not null and "loan_events"."annual_rate" between 0 and 100 and "loan_events"."amount" is null and "loan_events"."mode" is null and "loan_events"."balance" is null and "loan_events"."balance_delta" is null and "loan_events"."next_payment_date" is null and "loan_events"."payment_day" is null and "loan_events"."term_months" is null and "loan_events"."payment_amount" is null and "loan_events"."schedule_type" is null and "loan_events"."interest_method" is null and "loan_events"."end_date" is null and "loan_events"."holiday_mode" is null and "loan_events"."holiday_interest" is null and "loan_events"."holiday_shift" is null
    ) or (
      "loan_events"."type" = 'reconciliation' and "loan_events"."balance" is not null and "loan_events"."balance" >= 0 and "loan_events"."balance_delta" is not null and "loan_events"."amount" is null and "loan_events"."mode" is null and "loan_events"."annual_rate" is null and "loan_events"."next_payment_date" is null and "loan_events"."payment_day" is null and "loan_events"."term_months" is null and "loan_events"."payment_amount" is null and "loan_events"."schedule_type" is null and "loan_events"."interest_method" is null and "loan_events"."end_date" is null and "loan_events"."holiday_mode" is null and "loan_events"."holiday_interest" is null and "loan_events"."holiday_shift" is null
    ) or (
      "loan_events"."type" in ('correction', 'restructuring') and "loan_events"."annual_rate" is not null and "loan_events"."annual_rate" between 0 and 100 and "loan_events"."amount" is null and "loan_events"."mode" is null and ("loan_events"."balance" is null) = ("loan_events"."balance_delta" is null) and ("loan_events"."balance" is null or "loan_events"."balance" >= 0)
      and "loan_events"."next_payment_date" is not null and "loan_events"."next_payment_date" > "loan_events"."date" and "loan_events"."payment_day" between 1 and 31 and "loan_events"."term_months" between 1 and 600 and ("loan_events"."payment_amount" is null or "loan_events"."payment_amount" > 0) and "loan_events"."schedule_type" is not null and "loan_events"."interest_method" is not null and "loan_events"."end_date" is null and "loan_events"."holiday_mode" is null and "loan_events"."holiday_interest" is null and "loan_events"."holiday_shift" is null
    ) or (
      "loan_events"."type" = 'holiday' and "loan_events"."end_date" is not null and "loan_events"."end_date" >= "loan_events"."date" and "loan_events"."holiday_mode" is not null and "loan_events"."holiday_shift" is not null and ("loan_events"."holiday_mode" = 'no_payment') = ("loan_events"."holiday_interest" is not null)
      and ("loan_events"."balance_delta" is null or ("loan_events"."holiday_interest" = 'capitalize' and "loan_events"."balance_delta" <= 0)) and "loan_events"."amount" is null and "loan_events"."mode" is null and "loan_events"."annual_rate" is null and "loan_events"."balance" is null and "loan_events"."next_payment_date" is null and "loan_events"."payment_day" is null and "loan_events"."term_months" is null and "loan_events"."payment_amount" is null and "loan_events"."schedule_type" is null and "loan_events"."interest_method" is null
    ));