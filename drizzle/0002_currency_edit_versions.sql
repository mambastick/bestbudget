ALTER TABLE "financial_accounts" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;