CREATE TYPE "public"."exchange_rate_source" AS ENUM('cbr', 'manual');--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"currency" text NOT NULL,
	"date" date NOT NULL,
	"rate_to_rub" numeric(20, 10) NOT NULL,
	"source" "exchange_rate_source" NOT NULL,
	CONSTRAINT "exchange_rates_currency_date_source_pk" PRIMARY KEY("currency","date","source"),
	CONSTRAINT "exchange_rates_positive_ck" CHECK ("exchange_rates"."rate_to_rub" > 0)
);
--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD COLUMN "to_amount" bigint;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "to_amount" bigint;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_to_amount_ck" CHECK ("recurring_rules"."to_amount" is null or ("recurring_rules"."type" = 'transfer' and "recurring_rules"."to_amount" > 0));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_to_amount_ck" CHECK ("transactions"."to_amount" is null or ("transactions"."type" = 'transfer' and "transactions"."to_amount" > 0));--> statement-breakpoint
-- Serialize currency edits and operation writes on the account rows, including direct SQL writes.
CREATE FUNCTION bestbudget_check_operation_currency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source_currency text;
  target_currency text;
BEGIN
  PERFORM id FROM financial_accounts
    WHERE household_id = NEW.household_id AND id IN (NEW.account_id, NEW.to_account_id)
    ORDER BY id FOR UPDATE;
  SELECT currency INTO source_currency FROM financial_accounts WHERE household_id = NEW.household_id AND id = NEW.account_id;
  SELECT currency INTO target_currency FROM financial_accounts WHERE household_id = NEW.household_id AND id = NEW.to_account_id;
  IF NEW.type = 'transfer' AND source_currency <> target_currency AND NEW.to_amount IS NULL THEN
    RAISE EXCEPTION 'Cross-currency transfers require to_amount' USING ERRCODE = '23514';
  END IF;
  IF NEW.type = 'transfer' AND source_currency = target_currency AND NEW.to_amount IS NOT NULL AND NEW.to_amount <> NEW.amount THEN
    RAISE EXCEPTION 'Same-currency transfer amounts must match' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER transactions_currency_check BEFORE INSERT OR UPDATE OF amount, to_amount, type, account_id, to_account_id, household_id ON transactions
FOR EACH ROW EXECUTE FUNCTION bestbudget_check_operation_currency();
--> statement-breakpoint
CREATE TRIGGER recurring_rules_currency_check BEFORE INSERT OR UPDATE OF amount, to_amount, type, account_id, to_account_id, household_id ON recurring_rules
FOR EACH ROW EXECUTE FUNCTION bestbudget_check_operation_currency();
--> statement-breakpoint
CREATE FUNCTION bestbudget_guard_account_currency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.currency <> OLD.currency AND (
    EXISTS (SELECT 1 FROM transactions WHERE household_id = OLD.household_id AND (account_id = OLD.id OR to_account_id = OLD.id)) OR
    EXISTS (SELECT 1 FROM recurring_rules WHERE household_id = OLD.household_id AND (account_id = OLD.id OR to_account_id = OLD.id))
  ) THEN
    RAISE EXCEPTION 'Account currency is locked by operations' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER financial_accounts_currency_guard BEFORE UPDATE OF currency ON financial_accounts
FOR EACH ROW EXECUTE FUNCTION bestbudget_guard_account_currency();
