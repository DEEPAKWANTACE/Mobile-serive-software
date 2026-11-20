-- Return Note approval, day closing, call verification, manager permissions, part categories.
CREATE TYPE "ReturnNoteStatus" AS ENUM ('NONE', 'SUBMITTED', 'APPROVED', 'REJECTED');

ALTER TABLE "job_parts" ADD COLUMN "note_status" "ReturnNoteStatus" NOT NULL DEFAULT 'NONE';
ALTER TABLE "job_parts" ADD COLUMN "used_quantity" INTEGER;
ALTER TABLE "job_parts" ADD COLUMN "note_remark" TEXT;
ALTER TABLE "job_parts" ADD COLUMN "note_submitted_at" TIMESTAMP(3);
ALTER TABLE "job_parts" ADD COLUMN "note_submitted_by_id" UUID;
ALTER TABLE "job_parts" ADD COLUMN "note_decided_at" TIMESTAMP(3);
ALTER TABLE "job_parts" ADD COLUMN "note_decided_by_id" UUID;

-- Parts issued before return notes existed count as confirmed consumption.
UPDATE "job_parts" SET "note_status" = 'APPROVED', "used_quantity" = "quantity" WHERE "status" = 'ISSUED';

ALTER TABLE "call_logs" ADD COLUMN "verified_record_id" UUID;

CREATE TABLE "day_closings" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "date" TEXT NOT NULL,
    "expected_cash" DECIMAL(12,2) NOT NULL,
    "counted_cash" DECIMAL(12,2),
    "note" TEXT,
    "closed_by_id" UUID NOT NULL,
    "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "day_closings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "day_closings_branch_id_date_key" ON "day_closings"("branch_id", "date");
ALTER TABLE "day_closings" ADD CONSTRAINT "day_closings_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "day_closings" ADD CONSTRAINT "day_closings_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "call_records" (
    "id" UUID NOT NULL,
    "branch_id" UUID,
    "phone" TEXT NOT NULL,
    "called_at" TIMESTAMP(3) NOT NULL,
    "duration_sec" INTEGER NOT NULL DEFAULT 0,
    "connected" BOOLEAN NOT NULL DEFAULT false,
    "external_id" TEXT,
    "agent" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'IMPORT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "call_records_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "call_records_external_id_key" ON "call_records"("external_id");
CREATE INDEX "call_records_phone_called_at_idx" ON "call_records"("phone", "called_at");
ALTER TABLE "call_records" ADD CONSTRAINT "call_records_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "permission_overrides" (
    "id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "key" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "permission_overrides_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "permission_overrides_role_key_key" ON "permission_overrides"("role", "key");
ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "part_categories" (
    "id" UUID NOT NULL,
    "branch_id" UUID,
    "name" TEXT NOT NULL,
    "parent_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "part_categories_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "part_categories_branch_id_parent_id_idx" ON "part_categories"("branch_id", "parent_id");
