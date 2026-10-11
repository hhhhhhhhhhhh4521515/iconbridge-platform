-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "application_status_history" DROP COLUMN "notified_at",
ADD COLUMN     "email_id" UUID;

-- CreateTable
CREATE TABLE "email_outbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "template" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_outbox_status_next_attempt_at_idx" ON "email_outbox"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "application_status_history_email_id_idx" ON "application_status_history"("email_id");

-- AddForeignKey
ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_email_id_fkey" FOREIGN KEY ("email_id") REFERENCES "email_outbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

