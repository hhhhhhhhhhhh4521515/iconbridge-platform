-- AlterTable
ALTER TABLE "email_outbox" ADD COLUMN     "priority" SMALLINT NOT NULL DEFAULT 2;

-- CreateIndex
CREATE INDEX "email_outbox_status_priority_next_attempt_at_idx" ON "email_outbox"("status", "priority", "next_attempt_at");

-- CreateIndex
CREATE INDEX "email_outbox_template_sent_at_idx" ON "email_outbox"("template", "sent_at");

-- Hand-written: priorities are 1 (account access), 2 (applications) or 3 (bulk).
ALTER TABLE "email_outbox"
  ADD CONSTRAINT "email_outbox_priority_check" CHECK ("priority" BETWEEN 1 AND 3);

-- Emails already waiting get the priority of their template (the API sets it from now on).
-- Same table as EMAIL_PRIORITY in src/mail/mail-priority.ts.
UPDATE "email_outbox" SET "priority" = 1
  WHERE "status" = 'PENDING' AND "template" IN ('verify-email', 'reset-password', 'invitation', 'account-exists');
UPDATE "email_outbox" SET "priority" = 3
  WHERE "status" = 'PENDING' AND "template" IN ('job-alert', 'new-application', 'contact-message');
