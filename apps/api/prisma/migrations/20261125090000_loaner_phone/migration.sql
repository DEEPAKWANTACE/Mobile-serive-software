-- Loaner phone lent to a customer for the duration of a job.
ALTER TABLE "jobs" ADD COLUMN "loaner_model_id" UUID;
ALTER TABLE "jobs" ADD COLUMN "loaner_returned_at" TIMESTAMP(3);
ALTER TABLE "jobs" ADD COLUMN "loaner_returned_by_id" UUID;

ALTER TABLE "jobs" ADD CONSTRAINT "jobs_loaner_model_id_fkey" FOREIGN KEY ("loaner_model_id") REFERENCES "device_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_loaner_returned_by_id_fkey" FOREIGN KEY ("loaner_returned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
