ALTER TABLE "ai_conversations" ADD COLUMN "custom_title" text;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;