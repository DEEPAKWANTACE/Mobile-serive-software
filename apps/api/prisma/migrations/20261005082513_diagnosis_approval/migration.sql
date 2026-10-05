-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JobStatus" ADD VALUE 'AWAITING_APPROVAL';
ALTER TYPE "JobStatus" ADD VALUE 'IN_REPAIR';
ALTER TYPE "JobStatus" ADD VALUE 'CUSTOMER_REJECTED';
ALTER TYPE "JobStatus" ADD VALUE 'REPAIRED';
ALTER TYPE "JobStatus" ADD VALUE 'TESTING';
ALTER TYPE "JobStatus" ADD VALUE 'READY_FOR_DELIVERY';

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "approved_amount" DECIMAL(10,2),
ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by_id" UUID,
ADD COLUMN     "customer_response" TEXT,
ADD COLUMN     "diagnosed_at" TIMESTAMP(3),
ADD COLUMN     "diagnosis_notes" TEXT,
ADD COLUMN     "quoted_amount" DECIMAL(10,2),
ADD COLUMN     "ready_at" TIMESTAMP(3),
ADD COLUMN     "repaired_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "job_estimate_lines" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "fault_id" UUID,
    "description" TEXT,
    "price_label" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "job_estimate_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_estimate_lines_job_id_idx" ON "job_estimate_lines"("job_id");

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_estimate_lines" ADD CONSTRAINT "job_estimate_lines_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_estimate_lines" ADD CONSTRAINT "job_estimate_lines_fault_id_fkey" FOREIGN KEY ("fault_id") REFERENCES "faults"("id") ON DELETE SET NULL ON UPDATE CASCADE;

