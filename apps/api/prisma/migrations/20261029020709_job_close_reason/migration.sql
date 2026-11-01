-- CreateEnum
CREATE TYPE "job_close_reason" AS ENUM ('MANUAL', 'DEADLINE_PASSED', 'POSITIONS_FILLED');

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "close_reason" "job_close_reason";

-- A position is held from Contract signed on (ADR-025): the count of every job follows the
-- new rule. Capped by `positions`, which jobs_hired_count_check requires.
UPDATE "jobs" j
SET "hired_count" = LEAST(j."positions", (
  SELECT count(*) FROM "applications" a
  WHERE a."job_id" = j."id"
    AND a."status" IN ('CONTRACT_SIGNED', 'VISA_PROCESSING', 'VISA_APPROVED', 'DEPLOYED')
));

-- The reason of the jobs already closed, guessed from their state; a recruiter otherwise.
UPDATE "jobs"
SET "close_reason" = CASE
  WHEN "deadline" <= now() THEN 'DEADLINE_PASSED'::"job_close_reason"
  WHEN "hired_count" >= "positions" THEN 'POSITIONS_FILLED'::"job_close_reason"
  ELSE 'MANUAL'::"job_close_reason"
END
WHERE "status" = 'CLOSED';
