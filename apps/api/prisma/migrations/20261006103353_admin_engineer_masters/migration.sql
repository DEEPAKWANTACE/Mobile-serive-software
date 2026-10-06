-- CreateEnum
CREATE TYPE "WarrantyStatus" AS ENUM ('IN_WARRANTY', 'OUT_OF_WARRANTY');

-- CreateEnum
CREATE TYPE "AssignmentEndReason" AS ENUM ('REASSIGNED', 'TRANSFERRED', 'UNASSIGNED', 'SENT_TO_L4', 'CLOSED');

-- AlterEnum
ALTER TYPE "JobStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "city" TEXT;

-- AlterTable
ALTER TABLE "job_transfers" ADD COLUMN     "remark" TEXT;

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "cancel_reason" TEXT,
ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "device_password_enc" TEXT,
ADD COLUMN     "inward_by_id" UUID,
ADD COLUMN     "phone_damaged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "repair_remark" TEXT,
ADD COLUMN     "retailer" TEXT,
ADD COLUMN     "testing_at" TIMESTAMP(3),
ADD COLUMN     "testing_remark" TEXT,
ADD COLUMN     "warranty" "WarrantyStatus";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "password_changed_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "job_status_history" (
    "id" BIGSERIAL NOT NULL,
    "job_id" UUID NOT NULL,
    "from_status" "JobStatus",
    "to_status" "JobStatus" NOT NULL,
    "engineer_id" UUID,
    "changed_by_id" UUID,
    "remark" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_assignments" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "engineer_id" UUID NOT NULL,
    "assigned_by_id" UUID,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "end_reason" "AssignmentEndReason",
    "note" TEXT,

    CONSTRAINT "job_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_status_history_job_id_changed_at_idx" ON "job_status_history"("job_id", "changed_at");

-- CreateIndex
CREATE INDEX "job_status_history_engineer_id_changed_at_idx" ON "job_status_history"("engineer_id", "changed_at");

-- CreateIndex
CREATE INDEX "job_status_history_to_status_changed_at_idx" ON "job_status_history"("to_status", "changed_at");

-- CreateIndex
CREATE INDEX "job_assignments_job_id_assigned_at_idx" ON "job_assignments"("job_id", "assigned_at");

-- CreateIndex
CREATE INDEX "job_assignments_engineer_id_ended_at_idx" ON "job_assignments"("engineer_id", "ended_at");

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_inward_by_id_fkey" FOREIGN KEY ("inward_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_status_history" ADD CONSTRAINT "job_status_history_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_status_history" ADD CONSTRAINT "job_status_history_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_status_history" ADD CONSTRAINT "job_status_history_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_engineer_id_fkey" FOREIGN KEY ("engineer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_assignments" ADD CONSTRAINT "job_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: current engineer assignments and current status become the first history rows of existing jobs.
INSERT INTO "job_assignments" ("id", "job_id", "engineer_id", "assigned_at", "note")
SELECT gen_random_uuid(), "id", "assigned_engineer_id", COALESCE("assigned_at", "created_at"), 'Backfilled'
FROM "jobs" WHERE "assigned_engineer_id" IS NOT NULL;

INSERT INTO "job_status_history" ("job_id", "from_status", "to_status", "engineer_id", "changed_by_id", "remark", "changed_at")
SELECT "id", NULL, "status", "assigned_engineer_id", "created_by_id", 'Backfilled current status', "updated_at" FROM "jobs";

-- Inward staff defaults to whoever created the job sheet.
UPDATE "jobs" SET "inward_by_id" = "created_by_id" WHERE "inward_by_id" IS NULL;
