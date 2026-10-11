-- AlterTable
ALTER TABLE "application_status_history" ADD COLUMN     "notified_at" TIMESTAMPTZ(3),
ADD COLUMN     "reverted_at" TIMESTAMPTZ(3),
ADD COLUMN     "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "questions" JSONB;

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "questions" JSONB NOT NULL DEFAULT '[]';

