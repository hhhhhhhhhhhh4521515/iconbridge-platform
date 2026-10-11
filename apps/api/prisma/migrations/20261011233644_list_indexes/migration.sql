-- CreateIndex
CREATE INDEX "applications_applied_at_idx" ON "applications"("applied_at" DESC);

-- CreateIndex
CREATE INDEX "users_role_deleted_at_idx" ON "users"("role", "deleted_at");

