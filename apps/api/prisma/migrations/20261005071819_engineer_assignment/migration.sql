-- AlterEnum
ALTER TYPE "JobStatus" ADD VALUE 'ASSIGNED';

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "assigned_at" TIMESTAMP(3),
ADD COLUMN     "assigned_engineer_id" UUID;

-- CreateIndex
CREATE INDEX "jobs_assigned_engineer_id_status_idx" ON "jobs"("assigned_engineer_id", "status");

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_assigned_engineer_id_fkey" FOREIGN KEY ("assigned_engineer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
