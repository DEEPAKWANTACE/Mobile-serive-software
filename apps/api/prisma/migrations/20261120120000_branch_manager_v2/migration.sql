-- Branch Manager module: colour variants, expense approval, happy-calling fields, stock discrepancy, purchase orders, remarks.
ALTER TABLE "parts" ADD COLUMN "color" TEXT;

ALTER TABLE "expenses" ADD COLUMN "approved_by_id" UUID;
ALTER TABLE "expenses" ADD COLUMN "approved_at" TIMESTAMP(3);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "call_logs" ADD COLUMN "feedback" TEXT;
ALTER TABLE "call_logs" ADD COLUMN "satisfaction" INTEGER;
ALTER TABLE "call_logs" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MANUAL';

ALTER TABLE "stock_transfers" ADD COLUMN "received_quantity" INTEGER;
ALTER TABLE "stock_transfers" ADD COLUMN "discrepancy_note" TEXT;

CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'FORWARDED');

CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "po_number" TEXT NOT NULL,
    "branch_id" UUID NOT NULL,
    "from_date" TEXT NOT NULL,
    "to_date" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "lines" JSONB NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "forwarded_at" TIMESTAMP(3),
    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "purchase_orders_po_number_key" ON "purchase_orders"("po_number");
CREATE INDEX "purchase_orders_branch_id_created_at_idx" ON "purchase_orders"("branch_id", "created_at");
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "job_parts" ADD COLUMN "po_id" UUID;
ALTER TABLE "job_parts" ADD CONSTRAINT "job_parts_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "manager_remarks" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "remark" TEXT NOT NULL,
    "by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "manager_remarks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "manager_remarks_job_id_kind_created_at_idx" ON "manager_remarks"("job_id", "kind", "created_at");
ALTER TABLE "manager_remarks" ADD CONSTRAINT "manager_remarks_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "manager_remarks" ADD CONSTRAINT "manager_remarks_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manager_remarks" ADD CONSTRAINT "manager_remarks_by_id_fkey" FOREIGN KEY ("by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
