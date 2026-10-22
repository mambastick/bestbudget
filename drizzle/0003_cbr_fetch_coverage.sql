CREATE TABLE "exchange_rate_fetches" (
	"currency" text NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "exchange_rate_fetches_currency_from_date_to_date_pk" PRIMARY KEY("currency","from_date","to_date"),
	CONSTRAINT "exchange_rate_fetches_range_ck" CHECK ("exchange_rate_fetches"."from_date" <= "exchange_rate_fetches"."to_date")
);
