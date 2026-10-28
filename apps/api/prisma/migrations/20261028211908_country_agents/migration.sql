-- AlterEnum
ALTER TYPE "user_role" ADD VALUE 'COUNTRY_AGENT';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "assigned_countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "password_change_required" BOOLEAN NOT NULL DEFAULT false;

-- A country agent has at least one two-letter upper-case ISO code; every other role has
-- none (ADR-024). `role::text` because the new enum value cannot be used as a literal in
-- the transaction that adds it. Existing rows hold the default empty list.
ALTER TABLE "users" ADD CONSTRAINT "users_assigned_countries_check" CHECK (
  "assigned_countries" IS NOT NULL
  AND array_to_string("assigned_countries", ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$'
  AND (("role"::text = 'COUNTRY_AGENT') = (cardinality("assigned_countries") > 0))
);
