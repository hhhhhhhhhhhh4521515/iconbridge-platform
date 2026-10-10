-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('CANDIDATE', 'VIEWER', 'RECRUITER', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "email_token_type" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');

-- CreateEnum
CREATE TYPE "gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "education_level" AS ENUM ('NONE', 'PRIMARY', 'SECONDARY', 'VOCATIONAL', 'BACHELOR', 'MASTER', 'DOCTORATE');

-- CreateEnum
CREATE TYPE "language_level" AS ENUM ('A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'NATIVE');

-- CreateEnum
CREATE TYPE "document_type" AS ENUM ('CV', 'PASSPORT', 'PHOTO', 'DIPLOMA', 'CERTIFICATE', 'STCW', 'SEAMAN_BOOK', 'MEDICAL', 'OTHER');

-- CreateEnum
CREATE TYPE "job_status" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "salary_period" AS ENUM ('HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "application_status" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'CONTRACT_SIGNED', 'VISA_PROCESSING', 'VISA_APPROVED', 'DEPLOYED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "user_role" NOT NULL DEFAULT 'CANDIDATE',
    "email_verified_at" TIMESTAMPTZ(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "user_agent" TEXT,
    "ip" INET,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" "email_token_type" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "gender" "gender",
    "date_of_birth" DATE,
    "nationality" CHAR(2),
    "country_of_residence" CHAR(2),
    "city" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "passport_number_encrypted" TEXT,
    "passport_number_masked" TEXT,
    "passport_issuing_country" CHAR(2),
    "passport_issue_date" DATE,
    "passport_expiry_date" DATE,
    "current_profession" TEXT,
    "years_of_experience" SMALLINT,
    "education_level" "education_level",
    "driving_licence_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "has_stcw_training" BOOLEAN NOT NULL DEFAULT false,
    "has_seaman_book" BOOLEAN NOT NULL DEFAULT false,
    "has_medical_certificate" BOOLEAN NOT NULL DEFAULT false,
    "sea_experience" TEXT,
    "gdpr_consent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "candidate_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_languages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "candidate_id" UUID NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "level" "language_level" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "candidate_languages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "candidate_id" UUID NOT NULL,
    "type" "document_type" NOT NULL,
    "blob_path" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "destinations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "icon" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "destinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "icon" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "destination_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "employer_name" TEXT,
    "show_employer_name" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT NOT NULL,
    "requirements" TEXT,
    "accommodation_provided" BOOLEAN NOT NULL DEFAULT false,
    "transport_provided" BOOLEAN NOT NULL DEFAULT false,
    "meals_provided" BOOLEAN NOT NULL DEFAULT false,
    "benefits" TEXT,
    "salary_min" DECIMAL(10,2),
    "salary_max" DECIMAL(10,2),
    "salary_currency" CHAR(3),
    "salary_period" "salary_period",
    "contract_duration_months" SMALLINT,
    "working_hours" TEXT,
    "positions" INTEGER NOT NULL DEFAULT 1,
    "hired_count" INTEGER NOT NULL DEFAULT 0,
    "required_languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deadline" TIMESTAMPTZ(3) NOT NULL,
    "cover_image_path" TEXT,
    "status" "job_status" NOT NULL DEFAULT 'DRAFT',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    -- Hand-written: full-text search column, maintained by PostgreSQL.
    -- 'simple' configuration (no stemming) because offers are written in several languages.
    "search_vector" tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple'::regconfig, coalesce("title", '')), 'A') ||
        setweight(to_tsvector('simple'::regconfig, coalesce("description", '')), 'B')
    ) STORED,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "status" "application_status" NOT NULL DEFAULT 'SUBMITTED',
    "cover_letter" TEXT,
    "answers" JSONB,
    "profile_snapshot" JSONB NOT NULL,
    "applied_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawn_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "application_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "from_status" "application_status",
    "to_status" "application_status" NOT NULL,
    "changed_by_id" UUID,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "application_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "success_stories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "display_name" TEXT NOT NULL,
    "photo_path" TEXT,
    "job_title" TEXT NOT NULL,
    "destination_id" UUID NOT NULL,
    "visa_approved_at" DATE,
    "quote" JSONB NOT NULL,
    "consent_document_path" TEXT,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "application_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "success_stories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_slides" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" JSONB NOT NULL,
    "subtitle" JSONB,
    "image_path" TEXT NOT NULL,
    "cta_label" JSONB,
    "cta_url" TEXT,
    "destination_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "home_slides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_alert_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "destination_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "category_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "confirmed_at" TIMESTAMPTZ(3),
    "unsubscribe_token" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_alert_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "ip" INET,
    "handled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" INET,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_tokens_token_hash_key" ON "email_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_tokens_user_id_type_idx" ON "email_tokens"("user_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_profiles_user_id_key" ON "candidate_profiles"("user_id");

-- CreateIndex
CREATE INDEX "candidate_profiles_last_name_first_name_idx" ON "candidate_profiles"("last_name", "first_name");

-- CreateIndex
CREATE INDEX "candidate_profiles_passport_expiry_date_idx" ON "candidate_profiles"("passport_expiry_date");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_languages_candidate_id_language_key" ON "candidate_languages"("candidate_id", "language");

-- CreateIndex
CREATE UNIQUE INDEX "documents_blob_path_key" ON "documents"("blob_path");

-- CreateIndex
CREATE INDEX "documents_candidate_id_type_idx" ON "documents"("candidate_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "destinations_code_key" ON "destinations"("code");

-- CreateIndex
CREATE UNIQUE INDEX "job_categories_slug_key" ON "job_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_slug_key" ON "jobs"("slug");

-- CreateIndex
CREATE INDEX "jobs_status_destination_id_category_id_deadline_idx" ON "jobs"("status", "destination_id", "category_id", "deadline");

-- CreateIndex
CREATE INDEX "jobs_destination_id_idx" ON "jobs"("destination_id");

-- CreateIndex
CREATE INDEX "jobs_category_id_idx" ON "jobs"("category_id");

-- CreateIndex
CREATE INDEX "jobs_created_by_id_idx" ON "jobs"("created_by_id");

-- CreateIndex
CREATE INDEX "jobs_required_languages_idx" ON "jobs" USING GIN ("required_languages");

-- CreateIndex
CREATE INDEX "jobs_search_vector_idx" ON "jobs" USING GIN ("search_vector");

-- CreateIndex
CREATE INDEX "applications_candidate_id_job_id_applied_at_idx" ON "applications"("candidate_id", "job_id", "applied_at" DESC);

-- CreateIndex
CREATE INDEX "applications_job_id_status_idx" ON "applications"("job_id", "status");

-- CreateIndex
CREATE INDEX "applications_status_idx" ON "applications"("status");

-- CreateIndex
CREATE INDEX "application_documents_document_id_idx" ON "application_documents"("document_id");

-- CreateIndex
CREATE UNIQUE INDEX "application_documents_application_id_document_id_key" ON "application_documents"("application_id", "document_id");

-- CreateIndex
CREATE INDEX "application_status_history_application_id_created_at_idx" ON "application_status_history"("application_id", "created_at");

-- CreateIndex
CREATE INDEX "application_status_history_changed_by_id_idx" ON "application_status_history"("changed_by_id");

-- CreateIndex
CREATE INDEX "application_notes_application_id_created_at_idx" ON "application_notes"("application_id", "created_at");

-- CreateIndex
CREATE INDEX "application_notes_author_id_idx" ON "application_notes"("author_id");

-- CreateIndex
CREATE INDEX "success_stories_is_published_sort_order_idx" ON "success_stories"("is_published", "sort_order");

-- CreateIndex
CREATE INDEX "success_stories_destination_id_idx" ON "success_stories"("destination_id");

-- CreateIndex
CREATE INDEX "success_stories_application_id_idx" ON "success_stories"("application_id");

-- CreateIndex
CREATE INDEX "home_slides_is_active_sort_order_idx" ON "home_slides"("is_active", "sort_order");

-- CreateIndex
CREATE INDEX "home_slides_destination_id_idx" ON "home_slides"("destination_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_alert_subscriptions_unsubscribe_token_key" ON "job_alert_subscriptions"("unsubscribe_token");

-- CreateIndex
CREATE INDEX "job_alert_subscriptions_email_idx" ON "job_alert_subscriptions"("email");

-- CreateIndex
CREATE INDEX "contact_messages_handled_at_created_at_idx" ON "contact_messages"("handled_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_languages" ADD CONSTRAINT "candidate_languages_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidate_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidate_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "destinations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "job_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidate_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_notes" ADD CONSTRAINT "application_notes_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_notes" ADD CONSTRAINT "application_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "success_stories" ADD CONSTRAINT "success_stories_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "destinations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "success_stories" ADD CONSTRAINT "success_stories_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_slides" ADD CONSTRAINT "home_slides_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "destinations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: CHECK constraints (Prisma cannot express them in the schema).
-- ---------------------------------------------------------------------------

-- Emails are compared as stored, so they must be normalised to lower case.
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase_check" CHECK ("email" = lower("email"));
ALTER TABLE "job_alert_subscriptions" ADD CONSTRAINT "job_alert_subscriptions_email_lowercase_check" CHECK ("email" = lower("email"));

-- The encrypted passport number and its masked form are set and cleared together.
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_passport_number_pair_check"
    CHECK (("passport_number_encrypted" IS NULL) = ("passport_number_masked" IS NULL));
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_passport_dates_check"
    CHECK ("passport_issue_date" IS NULL OR "passport_expiry_date" IS NULL OR "passport_issue_date" < "passport_expiry_date");
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_years_of_experience_check"
    CHECK ("years_of_experience" IS NULL OR "years_of_experience" BETWEEN 0 AND 70);

ALTER TABLE "documents" ADD CONSTRAINT "documents_size_bytes_check" CHECK ("size_bytes" > 0);

-- A job cannot hire more people than it has positions.
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_positions_check" CHECK ("positions" >= 1);
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_hired_count_check" CHECK ("hired_count" >= 0 AND "hired_count" <= "positions");
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_salary_range_check"
    CHECK (("salary_min" IS NULL OR "salary_min" >= 0) AND ("salary_max" IS NULL OR "salary_max" >= 0)
       AND ("salary_min" IS NULL OR "salary_max" IS NULL OR "salary_min" <= "salary_max"));
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_contract_duration_check"
    CHECK ("contract_duration_months" IS NULL OR "contract_duration_months" >= 1);

-- A success story is published only with the candidate's written consent on file.
ALTER TABLE "success_stories" ADD CONSTRAINT "success_stories_consent_check"
    CHECK (NOT "is_published" OR "consent_document_path" IS NOT NULL);
