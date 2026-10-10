-- AlterTable
ALTER TABLE "application_status_history" ADD COLUMN     "message_to_candidate" TEXT;

-- AlterTable
ALTER TABLE "home_slides" ALTER COLUMN "image_path" DROP NOT NULL;

-- AlterTable
ALTER TABLE "job_alert_subscriptions" ADD COLUMN     "confirm_token_hash" TEXT,
ADD COLUMN     "locale" VARCHAR(2) NOT NULL DEFAULT 'en';

-- AlterTable
-- Hand-written so existing rows keep their name: display_name becomes first_name.
ALTER TABLE "success_stories" RENAME COLUMN "display_name" TO "first_name";
ALTER TABLE "success_stories" ADD COLUMN     "last_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "show_full_name" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "job_alert_notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subscription_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_alert_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_alert_notifications_job_id_idx" ON "job_alert_notifications"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_alert_notifications_subscription_id_job_id_key" ON "job_alert_notifications"("subscription_id", "job_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_alert_subscriptions_confirm_token_hash_key" ON "job_alert_subscriptions"("confirm_token_hash");

-- AddForeignKey
ALTER TABLE "job_alert_notifications" ADD CONSTRAINT "job_alert_notifications_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "job_alert_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_alert_notifications" ADD CONSTRAINT "job_alert_notifications_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written: CHECK constraints.
-- A slide is shown on the home page only with an image.
ALTER TABLE "home_slides" ADD CONSTRAINT "home_slides_active_image_check"
    CHECK (NOT "is_active" OR "image_path" IS NOT NULL);
ALTER TABLE "job_alert_subscriptions" ADD CONSTRAINT "job_alert_subscriptions_locale_check"
    CHECK ("locale" IN ('en', 'fr', 'ar'));
