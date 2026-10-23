ALTER TABLE "users" ADD COLUMN "last_seen_locale" text;
--> statement-breakpoint
UPDATE "users" SET "last_seen_locale" = 'ru' WHERE "last_seen_locale" IS NULL AND "locale" IS NULL;
