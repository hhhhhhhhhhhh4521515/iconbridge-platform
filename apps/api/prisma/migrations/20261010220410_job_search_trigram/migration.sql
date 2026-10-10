-- Hand-written: trigram matching for tolerant search on job titles.
-- On Azure Database for PostgreSQL the extension must be allow-listed first
-- (server parameter azure.extensions = PG_TRGM).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "jobs_title_trgm_idx" ON "jobs" USING GIN ("title" gin_trgm_ops);
