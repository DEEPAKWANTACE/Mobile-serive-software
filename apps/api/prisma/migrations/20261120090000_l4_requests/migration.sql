-- Engineer L4 transfer requests that the Branch Manager approves or rejects.
CREATE TYPE "L4RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "l4_requests" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "to_branch_id" UUID NOT NULL,
    "reason" TEXT,
    "status" "L4RequestStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" UUID NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,

    CONSTRAINT "l4_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "l4_requests_job_id_status_idx" ON "l4_requests"("job_id", "status");
CREATE INDEX "l4_requests_status_requested_at_idx" ON "l4_requests"("status", "requested_at");

ALTER TABLE "l4_requests" ADD CONSTRAINT "l4_requests_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "l4_requests" ADD CONSTRAINT "l4_requests_to_branch_id_fkey" FOREIGN KEY ("to_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "l4_requests" ADD CONSTRAINT "l4_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "l4_requests" ADD CONSTRAINT "l4_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
