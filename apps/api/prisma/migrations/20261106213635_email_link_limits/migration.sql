-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_link_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "email_link_last_at" TIMESTAMPTZ(3),
ADD COLUMN     "email_link_window_start" TIMESTAMPTZ(3);

-- Never negative (audit H2).
ALTER TABLE "users" ADD CONSTRAINT "users_email_link_count_check" CHECK ("email_link_count" >= 0);
