-- CreateTable
CREATE TABLE "job_estimate_options" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "is_approved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_estimate_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_estimate_options_job_id_idx" ON "job_estimate_options"("job_id");

-- AddForeignKey
ALTER TABLE "job_estimate_options" ADD CONSTRAINT "job_estimate_options_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

