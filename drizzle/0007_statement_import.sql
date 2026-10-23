ALTER TABLE "transactions" ADD CONSTRAINT "transactions_household_id_uq" UNIQUE("household_id","id");--> statement-breakpoint
CREATE TABLE "category_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"description_mode" text DEFAULT 'substring' NOT NULL,
	"description_pattern" text,
	"mcc" text,
	"currency" text,
	"min_amount" bigint,
	"max_amount" bigint,
	"priority" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_rules_mode_ck" CHECK ("category_rules"."description_mode" in ('substring', 'regex')),
	CONSTRAINT "category_rules_mcc_ck" CHECK ("category_rules"."mcc" is null or "category_rules"."mcc" ~ '^[0-9]{4}$'),
	CONSTRAINT "category_rules_range_ck" CHECK ("category_rules"."min_amount" is null or "category_rules"."max_amount" is null or "category_rules"."min_amount" <= "category_rules"."max_amount")
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid,
	"source" text NOT NULL,
	"profile_version" integer NOT NULL,
	"file_hash" text NOT NULL,
	"period_from" date,
	"period_to" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"config" jsonb NOT NULL,
	"counters" jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone,
	CONSTRAINT "import_batches_household_id_uq" UNIQUE("household_id","id"),
	CONSTRAINT "import_batches_status_ck" CHECK ("import_batches"."status" in ('draft', 'committed', 'undone'))
);
--> statement-breakpoint
CREATE TABLE "import_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"config" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_profiles_name_uq" UNIQUE("household_id","name")
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_index" integer NOT NULL,
	"row_locator" text NOT NULL,
	"account_id" uuid,
	"category_id" uuid,
	"normalized" jsonb NOT NULL,
	"proposal" jsonb NOT NULL,
	"fingerprint" text,
	"external_key" text,
	"decision" text DEFAULT 'skip' NOT NULL,
	"transaction_id" uuid,
	"transaction_version" integer,
	"effect" text,
	"before_transaction" jsonb,
	CONSTRAINT "import_rows_batch_index_uq" UNIQUE("batch_id","row_index")
);
--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_category_fk" FOREIGN KEY ("household_id","category_id") REFERENCES "public"."categories"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_account_fk" FOREIGN KEY ("household_id","account_id") REFERENCES "public"."financial_accounts"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_profiles" ADD CONSTRAINT "import_profiles_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_profiles" ADD CONSTRAINT "import_profiles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_fk" FOREIGN KEY ("household_id","batch_id") REFERENCES "public"."import_batches"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_account_fk" FOREIGN KEY ("household_id","account_id") REFERENCES "public"."financial_accounts"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_category_fk" FOREIGN KEY ("household_id","category_id") REFERENCES "public"."categories"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_transaction_fk" FOREIGN KEY ("household_id","transaction_id") REFERENCES "public"."transactions"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "category_rules_household_idx" ON "category_rules" USING btree ("household_id","priority");--> statement-breakpoint
CREATE INDEX "import_batches_household_idx" ON "import_batches" USING btree ("household_id","created_at");--> statement-breakpoint
CREATE INDEX "import_batches_hash_idx" ON "import_batches" USING btree ("household_id","file_hash");--> statement-breakpoint
CREATE INDEX "import_rows_fingerprint_idx" ON "import_rows" USING btree ("household_id","fingerprint");--> statement-breakpoint
CREATE INDEX "import_rows_transaction_idx" ON "import_rows" USING btree ("household_id","transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_rows_external_key_uq" ON "import_rows" USING btree ("household_id","external_key") WHERE "import_rows"."external_key" is not null;--> statement-breakpoint
