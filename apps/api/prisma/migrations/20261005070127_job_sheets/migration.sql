-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('RECEIVED');

-- CreateEnum
CREATE TYPE "PhotoKind" AS ENUM ('CUSTOMER', 'ID_PROOF', 'DEVICE');

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "alt_phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "job_number" TEXT NOT NULL,
    "branch_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "device_model_id" UUID NOT NULL,
    "imei" TEXT,
    "serial_number" TEXT,
    "color" TEXT,
    "customer_complaint" TEXT,
    "condition_notes" TEXT,
    "accessories" TEXT[],
    "accessories_other" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'RECEIVED',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_faults" (
    "job_id" UUID NOT NULL,
    "fault_id" UUID NOT NULL,

    CONSTRAINT "job_faults_pkey" PRIMARY KEY ("job_id","fault_id")
);

-- CreateTable
CREATE TABLE "job_counters" (
    "branch_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "last_seq" INTEGER NOT NULL,

    CONSTRAINT "job_counters_pkey" PRIMARY KEY ("branch_id","period")
);

-- CreateTable
CREATE TABLE "job_photos" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "kind" "PhotoKind" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_job_number_key" ON "jobs"("job_number");

-- CreateIndex
CREATE INDEX "jobs_branch_id_created_at_idx" ON "jobs"("branch_id", "created_at");

-- CreateIndex
CREATE INDEX "jobs_branch_id_status_idx" ON "jobs"("branch_id", "status");

-- CreateIndex
CREATE INDEX "jobs_customer_id_idx" ON "jobs"("customer_id");

-- CreateIndex
CREATE INDEX "jobs_imei_idx" ON "jobs"("imei");

-- CreateIndex
CREATE UNIQUE INDEX "job_photos_storage_key_key" ON "job_photos"("storage_key");

-- CreateIndex
CREATE INDEX "job_photos_job_id_idx" ON "job_photos"("job_id");

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_device_model_id_fkey" FOREIGN KEY ("device_model_id") REFERENCES "device_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_faults" ADD CONSTRAINT "job_faults_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_faults" ADD CONSTRAINT "job_faults_fault_id_fkey" FOREIGN KEY ("fault_id") REFERENCES "faults"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_counters" ADD CONSTRAINT "job_counters_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_photos" ADD CONSTRAINT "job_photos_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_photos" ADD CONSTRAINT "job_photos_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
