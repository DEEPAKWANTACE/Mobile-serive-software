-- A CCO's cancellation now waits for the Branch Manager, like an RWR.
ALTER TYPE "JobStatus" ADD VALUE 'CANCEL_PENDING' AFTER 'RWR';

ALTER TABLE "jobs" ADD COLUMN "cancel_requested_at" TIMESTAMP(3);
ALTER TABLE "jobs" ADD COLUMN "cancel_requested_by_id" UUID;
ALTER TABLE "jobs" ADD COLUMN "cancel_refund_mode" "PaymentMode";
ALTER TABLE "jobs" ADD COLUMN "status_before_cancel" "JobStatus";

ALTER TABLE "jobs" ADD CONSTRAINT "jobs_cancel_requested_by_id_fkey" FOREIGN KEY ("cancel_requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
