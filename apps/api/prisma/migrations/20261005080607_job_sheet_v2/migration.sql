-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('CASH', 'UPI', 'CARD');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('ADVANCE', 'FINAL');

-- DropIndex
DROP INDEX "service_prices_device_model_id_fault_id_key";

-- AlterTable
ALTER TABLE "faults" ADD COLUMN     "category_id" UUID,
ADD COLUMN     "requires_id_proof" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "job_faults" ADD COLUMN     "price" DECIMAL(10,2),
ADD COLUMN     "price_label" TEXT;

-- AlterTable
ALTER TABLE "service_prices" ADD COLUMN     "label" TEXT NOT NULL DEFAULT 'Standard';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "aadhaar_number" TEXT,
ADD COLUMN     "aadhaar_photo_key" TEXT,
ADD COLUMN     "address" TEXT;

-- CreateTable
CREATE TABLE "fault_categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fault_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "kind" "PaymentKind" NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reference" TEXT,
    "received_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fault_categories_name_key" ON "fault_categories"("name");

-- CreateIndex
CREATE INDEX "payments_job_id_idx" ON "payments"("job_id");

-- CreateIndex
CREATE INDEX "payments_branch_id_created_at_idx" ON "payments"("branch_id", "created_at");

-- CreateIndex
CREATE INDEX "faults_category_id_idx" ON "faults"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_prices_device_model_id_fault_id_label_key" ON "service_prices"("device_model_id", "fault_id", "label");

-- AddForeignKey
ALTER TABLE "faults" ADD CONSTRAINT "faults_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "fault_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

