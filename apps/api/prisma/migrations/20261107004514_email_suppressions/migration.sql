-- CreateTable
CREATE TABLE "email_suppressions" (
    "email_hash" CHAR(64) NOT NULL,
    "reason" VARCHAR(16) NOT NULL,
    "last_event_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("email_hash")
);

-- CreateIndex
CREATE INDEX "email_suppressions_last_event_at_idx" ON "email_suppressions"("last_event_at");

-- Hand-written (audit M2): only a SHA-256 in hexadecimal, and the two statuses that stop sending.
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_email_hash_check" CHECK ("email_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_reason_check" CHECK ("reason" IN ('BOUNCED', 'SUPPRESSED'));
