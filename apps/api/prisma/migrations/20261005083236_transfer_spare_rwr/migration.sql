-- CreateEnum
CREATE TYPE "RwrReason" AS ENUM ('SPARE_NOT_AVAILABLE', 'NOT_REPAIRABLE', 'CUSTOMER_REJECTED', 'OTHER');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JobStatus" ADD VALUE 'SPARE_PENDING';
ALTER TYPE "JobStatus" ADD VALUE 'RWR';

-- AlterEnum
ALTER TYPE "PhotoKind" ADD VALUE 'RWR';

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "rwr_at" TIMESTAMP(3),
ADD COLUMN     "rwr_note" TEXT,
ADD COLUMN     "rwr_reason" "RwrReason",
ADD COLUMN     "spare_part" TEXT,
ADD COLUMN     "spare_requested_at" TIMESTAMP(3),
ADD COLUMN     "status_before_hold" "JobStatus";

-- CreateTable
CREATE TABLE "job_transfers" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "from_engineer_id" UUID NOT NULL,
    "to_engineer_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
    "response_note" TEXT,
    "held_since" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),
    "faultId" UUID,

    CONSTRAINT "job_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_transfers_job_id_status_idx" ON "job_transfers"("job_id", "status");

-- CreateIndex
CREATE INDEX "job_transfers_to_engineer_id_status_idx" ON "job_transfers"("to_engineer_id", "status");

-- AddForeignKey
ALTER TABLE "job_transfers" ADD CONSTRAINT "job_transfers_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_transfers" ADD CONSTRAINT "job_transfers_from_engineer_id_fkey" FOREIGN KEY ("from_engineer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_transfers" ADD CONSTRAINT "job_transfers_to_engineer_id_fkey" FOREIGN KEY ("to_engineer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_transfers" ADD CONSTRAINT "job_transfers_faultId_fkey" FOREIGN KEY ("faultId") REFERENCES "faults"("id") ON DELETE SET NULL ON UPDATE CASCADE;

