-- ADR-027: partner spaces. New tables only, a nullable column and a wider CHECK: the API
-- version still running keeps working while this migration runs.

-- CreateEnum
CREATE TYPE "partner_member_kind" AS ENUM ('STAFF', 'PARTNER');

-- CreateEnum
CREATE TYPE "partner_job_status" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "partner_visa_status" AS ENUM ('NOT_STARTED', 'APPOINTMENT_BOOKED', 'SUBMITTED', 'APPROVED', 'REFUSED');

-- CreateEnum
CREATE TYPE "partner_file_kind" AS ENUM ('PASSPORT', 'CV', 'WORK_PERMIT');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "display_name" VARCHAR(80);

-- CreateTable
CREATE TABLE "partner_spaces" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "country" CHAR(2) NOT NULL,
    "default_locale" VARCHAR(2) NOT NULL,
    "logo_path" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "partner_spaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_space_members" (
    "partner_space_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "partner_member_kind" NOT NULL,
    "added_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "partner_space_members_pkey" PRIMARY KEY ("partner_space_id","user_id")
);

-- CreateTable
CREATE TABLE "partner_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "partner_space_id" UUID NOT NULL,
    "role" VARCHAR(120) NOT NULL,
    "positions" INTEGER NOT NULL,
    "locations" TEXT[],
    "salary" VARCHAR(200),
    "description" VARCHAR(5000) NOT NULL DEFAULT '',
    "status" "partner_job_status" NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "partner_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "partner_space_id" UUID NOT NULL,
    "partner_job_id" UUID NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "nationality" CHAR(2) NOT NULL,
    "phone" VARCHAR(16),
    "email" VARCHAR(254),
    "visa_status" "partner_visa_status" NOT NULL DEFAULT 'NOT_STARTED',
    "visa_appointment_date" DATE,
    "visa_decision_date" DATE,
    "dhl_sent_date" DATE,
    "dhl_tracking_number" VARCHAR(40),
    "documents_received_date" DATE,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "partner_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "partner_space_id" UUID NOT NULL,
    "partner_application_id" UUID NOT NULL,
    "kind" "partner_file_kind" NOT NULL,
    "format" VARCHAR(10) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "storage_path" TEXT NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "partner_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "partner_space_id" UUID NOT NULL,
    "partner_job_id" UUID,
    "partner_application_id" UUID,
    "author_id" UUID,
    "author_name" VARCHAR(254) NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "partner_space_id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_name" VARCHAR(254) NOT NULL,
    "entity_type" VARCHAR(30) NOT NULL,
    "entity_id" UUID NOT NULL,
    "partner_application_id" UUID,
    "action" VARCHAR(40) NOT NULL,
    "field" VARCHAR(60),
    "old_value" VARCHAR(500),
    "new_value" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partner_space_members_user_id_idx" ON "partner_space_members"("user_id");

-- CreateIndex
CREATE INDEX "partner_jobs_partner_space_id_status_created_at_idx" ON "partner_jobs"("partner_space_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "partner_jobs_partner_space_id_id_key" ON "partner_jobs"("partner_space_id", "id");

-- CreateIndex
CREATE INDEX "partner_applications_partner_space_id_partner_job_id_idx" ON "partner_applications"("partner_space_id", "partner_job_id");

-- CreateIndex
CREATE INDEX "partner_applications_partner_space_id_visa_status_idx" ON "partner_applications"("partner_space_id", "visa_status");

-- CreateIndex
CREATE UNIQUE INDEX "partner_applications_partner_space_id_id_key" ON "partner_applications"("partner_space_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "partner_files_storage_path_key" ON "partner_files"("storage_path");

-- CreateIndex
CREATE INDEX "partner_files_partner_space_id_idx" ON "partner_files"("partner_space_id");

-- CreateIndex
CREATE UNIQUE INDEX "partner_files_partner_application_id_kind_key" ON "partner_files"("partner_application_id", "kind");

-- CreateIndex
CREATE INDEX "partner_comments_partner_space_id_partner_job_id_created_at_idx" ON "partner_comments"("partner_space_id", "partner_job_id", "created_at");

-- CreateIndex
CREATE INDEX "partner_comments_partner_space_id_partner_application_id_cr_idx" ON "partner_comments"("partner_space_id", "partner_application_id", "created_at");

-- CreateIndex
CREATE INDEX "partner_history_partner_space_id_created_at_idx" ON "partner_history"("partner_space_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "partner_history_partner_space_id_entity_type_entity_id_idx" ON "partner_history"("partner_space_id", "entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "partner_spaces" ADD CONSTRAINT "partner_spaces_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_space_members" ADD CONSTRAINT "partner_space_members_partner_space_id_fkey" FOREIGN KEY ("partner_space_id") REFERENCES "partner_spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_space_members" ADD CONSTRAINT "partner_space_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_space_members" ADD CONSTRAINT "partner_space_members_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_jobs" ADD CONSTRAINT "partner_jobs_partner_space_id_fkey" FOREIGN KEY ("partner_space_id") REFERENCES "partner_spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_jobs" ADD CONSTRAINT "partner_jobs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_jobs" ADD CONSTRAINT "partner_jobs_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_partner_space_id_fkey" FOREIGN KEY ("partner_space_id") REFERENCES "partner_spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_partner_space_id_partner_job_id_fkey" FOREIGN KEY ("partner_space_id", "partner_job_id") REFERENCES "partner_jobs"("partner_space_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_files" ADD CONSTRAINT "partner_files_partner_space_id_fkey" FOREIGN KEY ("partner_space_id") REFERENCES "partner_spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_files" ADD CONSTRAINT "partner_files_partner_space_id_partner_application_id_fkey" FOREIGN KEY ("partner_space_id", "partner_application_id") REFERENCES "partner_applications"("partner_space_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_files" ADD CONSTRAINT "partner_files_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_comments" ADD CONSTRAINT "partner_comments_partner_space_id_fkey" FOREIGN KEY ("partner_space_id") REFERENCES "partner_spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_comments" ADD CONSTRAINT "partner_comments_partner_space_id_partner_job_id_fkey" FOREIGN KEY ("partner_space_id", "partner_job_id") REFERENCES "partner_jobs"("partner_space_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_comments" ADD CONSTRAINT "partner_comments_partner_space_id_partner_application_id_fkey" FOREIGN KEY ("partner_space_id", "partner_application_id") REFERENCES "partner_applications"("partner_space_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_comments" ADD CONSTRAINT "partner_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_history" ADD CONSTRAINT "partner_history_partner_space_id_fkey" FOREIGN KEY ("partner_space_id") REFERENCES "partner_spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_history" ADD CONSTRAINT "partner_history_partner_space_id_partner_application_id_fkey" FOREIGN KEY ("partner_space_id", "partner_application_id") REFERENCES "partner_applications"("partner_space_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_history" ADD CONSTRAINT "partner_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written rules (Prisma cannot express them; listed in docs/ARCHITECTURE.md)
-- ---------------------------------------------------------------------------

-- A PARTNER login may use Polish; every other account keeps en, fr or ar.
ALTER TABLE "users" DROP CONSTRAINT "users_locale_check";
ALTER TABLE "users" ADD CONSTRAINT "users_locale_check"
  CHECK ("locale" IN ('en', 'fr', 'ar') OR ("role" = 'PARTNER' AND "locale" = 'pl'));

CREATE UNIQUE INDEX "partner_spaces_name_lower_key" ON "partner_spaces" (lower("name"));
ALTER TABLE "partner_spaces" ADD CONSTRAINT "partner_spaces_country_check"
  CHECK ("country" ~ '^[A-Z]{2}$');
ALTER TABLE "partner_spaces" ADD CONSTRAINT "partner_spaces_default_locale_check"
  CHECK ("default_locale" IN ('en', 'fr', 'pl'));

-- A partner login belongs to exactly one space.
CREATE UNIQUE INDEX "partner_space_members_partner_login_key"
  ON "partner_space_members" ("user_id") WHERE "kind" = 'PARTNER';

ALTER TABLE "partner_jobs" ADD CONSTRAINT "partner_jobs_positions_check" CHECK ("positions" > 0);
ALTER TABLE "partner_jobs" ADD CONSTRAINT "partner_jobs_locations_check"
  CHECK ("locations" IS NOT NULL AND cardinality("locations") BETWEEN 1 AND 10);
ALTER TABLE "partner_jobs" ADD CONSTRAINT "partner_jobs_closed_at_check"
  CHECK (("status" = 'CLOSED') = ("closed_at" IS NOT NULL));

ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_nationality_check"
  CHECK ("nationality" ~ '^[A-Z]{2}$');
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_phone_check"
  CHECK ("phone" IS NULL OR "phone" ~ '^\+[1-9][0-9]{6,14}$');
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_email_check"
  CHECK ("email" IS NULL OR "email" = lower("email"));
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_visa_decision_check"
  CHECK ("visa_decision_date" IS NULL OR "visa_status" IN ('APPROVED', 'REFUSED'));
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_dhl_check"
  CHECK ("dhl_tracking_number" IS NULL OR "dhl_sent_date" IS NOT NULL);

ALTER TABLE "partner_files" ADD CONSTRAINT "partner_files_size_check" CHECK ("size_bytes" > 0);
ALTER TABLE "partner_files" ADD CONSTRAINT "partner_files_sha256_check"
  CHECK ("sha256" ~ '^[0-9a-f]{64}$');

-- A comment is about exactly one job demand or one application, and is never empty.
ALTER TABLE "partner_comments" ADD CONSTRAINT "partner_comments_target_check"
  CHECK (num_nonnulls("partner_job_id", "partner_application_id") = 1);
ALTER TABLE "partner_comments" ADD CONSTRAINT "partner_comments_body_check"
  CHECK (length(btrim("body")) > 0);
