-- AlterTable
ALTER TABLE "partner_jobs" ADD COLUMN     "salary_amount" INTEGER,
ADD COLUMN     "salary_currency" CHAR(3),
ADD COLUMN     "salary_period" VARCHAR(5);

-- Hand-written: the salary rules (ADR-027, amendment 3). Existing rows have no amount, so
-- they pass; the free text "salary" is kept as notes.
ALTER TABLE "partner_jobs" ADD CONSTRAINT "partner_jobs_salary_amount_check" CHECK ("salary_amount" IS NULL OR "salary_amount" > 0);
ALTER TABLE "partner_jobs" ADD CONSTRAINT "partner_jobs_salary_currency_check" CHECK ("salary_currency" IS NULL OR "salary_currency" IN ('EUR', 'PLN', 'USD', 'GBP', 'CHF', 'CZK'));
ALTER TABLE "partner_jobs" ADD CONSTRAINT "partner_jobs_salary_period_check" CHECK ("salary_period" IS NULL OR "salary_period" IN ('HOUR', 'MONTH', 'YEAR'));
ALTER TABLE "partner_jobs" ADD CONSTRAINT "partner_jobs_salary_complete_check" CHECK (
  ("salary_amount" IS NULL AND "salary_currency" IS NULL AND "salary_period" IS NULL)
  OR ("salary_amount" IS NOT NULL AND "salary_currency" IS NOT NULL AND "salary_period" IS NOT NULL)
);
