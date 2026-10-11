-- CreateEnum
CREATE TYPE "HistoricalMetric" AS ENUM ('VISAS_APPROVED', 'CANDIDATES_DEPLOYED', 'CANDIDATES_REGISTERED', 'PARTNER_COMPANIES', 'COUNTRIES_SERVED');

-- CreateTable
CREATE TABLE "historical_figures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "metric" "HistoricalMetric" NOT NULL,
    "year" SMALLINT,
    "destination_id" UUID,
    "value" INTEGER NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "historical_figures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "historical_figures_destination_id_idx" ON "historical_figures"("destination_id");

-- AddForeignKey
ALTER TABLE "historical_figures" ADD CONSTRAINT "historical_figures_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "destinations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One figure per (metric, year, destination); two NULLs count as the same value.
CREATE UNIQUE INDEX "historical_figures_metric_year_destination_key"
  ON "historical_figures" ("metric", "year", "destination_id") NULLS NOT DISTINCT;

-- A figure is never negative.
ALTER TABLE "historical_figures"
  ADD CONSTRAINT "historical_figures_value_check" CHECK ("value" >= 0);

-- The two global figures have neither year nor destination; the others have both.
ALTER TABLE "historical_figures"
  ADD CONSTRAINT "historical_figures_scope_check" CHECK (
    ("metric" IN ('PARTNER_COMPANIES', 'COUNTRIES_SERVED') AND "year" IS NULL AND "destination_id" IS NULL)
    OR ("metric" NOT IN ('PARTNER_COMPANIES', 'COUNTRIES_SERVED')
        AND "year" IS NOT NULL AND "destination_id" IS NOT NULL AND "year" BETWEEN 1990 AND 2100)
  );
