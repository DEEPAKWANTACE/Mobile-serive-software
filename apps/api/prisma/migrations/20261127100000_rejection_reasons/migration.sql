-- Reasons a customer rejects an estimate, picked from a list at customer approval.
-- Null branch rows are global defaults (Super Admin); branch rows are added by that branch's manager or Super Admin.
CREATE TABLE "rejection_reasons" (
  "id" UUID NOT NULL,
  "branch_id" UUID,
  "name" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "rejection_reasons_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rejection_reasons_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "rejection_reasons_branch_id_name_key" ON "rejection_reasons"("branch_id", "name");
CREATE INDEX "rejection_reasons_branch_id_is_active_idx" ON "rejection_reasons"("branch_id", "is_active");
CREATE UNIQUE INDEX "rejection_reasons_global_name_key" ON "rejection_reasons"("name") WHERE "branch_id" IS NULL;

INSERT INTO "rejection_reasons" ("id", "name", "sort_order", "updated_at") VALUES
  (gen_random_uuid(), 'Too costly', 10, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Will buy a new phone', 20, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Repair takes too long', 30, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Will repair elsewhere', 40, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Data / phone not needed now', 50, CURRENT_TIMESTAMP);
