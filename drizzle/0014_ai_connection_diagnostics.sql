ALTER TABLE "ai_settings" ADD COLUMN "api_key_last4" text;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD COLUMN "last_error_code" text;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD COLUMN "last_error_status" integer;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD COLUMN "last_error_at" timestamp with time zone;