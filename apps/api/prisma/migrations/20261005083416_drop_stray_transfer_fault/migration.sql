-- DropForeignKey
ALTER TABLE "job_transfers" DROP CONSTRAINT "job_transfers_faultId_fkey";

-- AlterTable
ALTER TABLE "job_transfers" DROP COLUMN "faultId";

