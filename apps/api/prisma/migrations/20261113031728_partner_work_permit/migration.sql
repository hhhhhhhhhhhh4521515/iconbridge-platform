-- CreateEnum
CREATE TYPE "partner_work_permit_status" AS ENUM ('NOT_STARTED', 'SUBMITTED', 'APPROVED', 'REFUSED');

-- AlterTable
ALTER TABLE "partner_applications" ADD COLUMN     "work_permit_decision_date" DATE,
ADD COLUMN     "work_permit_status" "partner_work_permit_status" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "work_permit_submitted_date" DATE;

-- CreateIndex
CREATE INDEX "partner_applications_partner_space_id_work_permit_status_idx" ON "partner_applications"("partner_space_id", "work_permit_status");

-- A decision date only for a decided work permit (ADR-027, amendment 1). The new columns are
-- NULL on every existing row, so the check validates at once.
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_work_permit_decision_check"
  CHECK ("work_permit_decision_date" IS NULL OR "work_permit_status" IN ('APPROVED', 'REFUSED'));
