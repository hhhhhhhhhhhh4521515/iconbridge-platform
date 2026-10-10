-- refresh_tokens has no row yet (authentication did not exist before this migration),
-- so family_id can be added as NOT NULL without a default.
-- AlterEnum
ALTER TYPE "email_token_type" ADD VALUE 'INVITATION';

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "family_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "failed_login_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "locale" VARCHAR(2) NOT NULL DEFAULT 'en',
ADD COLUMN     "locked_until" TIMESTAMPTZ(3),
ADD COLUMN     "token_version" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "password_hash" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- Hand-written: the email language must be one of the site languages.
ALTER TABLE "users" ADD CONSTRAINT "users_locale_check" CHECK ("locale" IN ('en', 'fr', 'ar'));
ALTER TABLE "users" ADD CONSTRAINT "users_failed_login_count_check" CHECK ("failed_login_count" >= 0);
