-- CreateEnum
CREATE TYPE "JobLocation" AS ENUM ('AT_BRANCH', 'TO_L4', 'TO_BRANCH');

-- CreateEnum
CREATE TYPE "MovementDirection" AS ENUM ('TO_L4', 'TO_BRANCH');

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "current_branch_id" UUID,
ADD COLUMN     "location" "JobLocation" NOT NULL DEFAULT 'AT_BRANCH';

-- Existing jobs are at their own branch.
UPDATE "jobs" SET "current_branch_id" = "branch_id" WHERE "current_branch_id" IS NULL;
ALTER TABLE "jobs" ALTER COLUMN "current_branch_id" SET NOT NULL;

-- CreateTable
CREATE TABLE "job_movements" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "direction" "MovementDirection" NOT NULL,
    "from_branch_id" UUID NOT NULL,
    "to_branch_id" UUID NOT NULL,
    "reason" TEXT,
    "sent_by_id" UUID NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_by_id" UUID,
    "received_at" TIMESTAMP(3),
    "receive_note" TEXT,

    CONSTRAINT "job_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_movements_job_id_sent_at_idx" ON "job_movements"("job_id", "sent_at");

-- CreateIndex
CREATE INDEX "job_movements_to_branch_id_received_at_idx" ON "job_movements"("to_branch_id", "received_at");

-- CreateIndex
CREATE INDEX "job_movements_from_branch_id_sent_at_idx" ON "job_movements"("from_branch_id", "sent_at");

-- CreateIndex
CREATE INDEX "jobs_current_branch_id_status_idx" ON "jobs"("current_branch_id", "status");

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_current_branch_id_fkey" FOREIGN KEY ("current_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_movements" ADD CONSTRAINT "job_movements_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_movements" ADD CONSTRAINT "job_movements_from_branch_id_fkey" FOREIGN KEY ("from_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_movements" ADD CONSTRAINT "job_movements_to_branch_id_fkey" FOREIGN KEY ("to_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_movements" ADD CONSTRAINT "job_movements_sent_by_id_fkey" FOREIGN KEY ("sent_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_movements" ADD CONSTRAINT "job_movements_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

