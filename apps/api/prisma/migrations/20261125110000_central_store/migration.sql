-- Central Store: its own location type and storekeeper role, purchase order decisions and supply challans.
ALTER TYPE "Role" ADD VALUE 'CENTRAL_STOREKEEPER';
ALTER TYPE "BranchType" ADD VALUE 'CENTRAL_STORE';
ALTER TYPE "PurchaseOrderStatus" ADD VALUE 'ACCEPTED';
ALTER TYPE "PurchaseOrderStatus" ADD VALUE 'REJECTED';
ALTER TYPE "PurchaseOrderStatus" ADD VALUE 'CLOSED';
CREATE TYPE "PurchaseOrderSource" AS ENUM ('CONSUMPTION', 'MANUAL');

ALTER TABLE "purchase_orders" ADD COLUMN "source" "PurchaseOrderSource" NOT NULL DEFAULT 'CONSUMPTION';
ALTER TABLE "purchase_orders" ADD COLUMN "central_note" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "decided_at" TIMESTAMP(3);

CREATE TABLE "stock_supplies" (
    "id" UUID NOT NULL,
    "challan_number" TEXT NOT NULL,
    "purchase_order_id" UUID,
    "to_branch_id" UUID NOT NULL,
    "note" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_supplies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stock_supplies_challan_number_key" ON "stock_supplies"("challan_number");
CREATE INDEX "stock_supplies_to_branch_id_created_at_idx" ON "stock_supplies"("to_branch_id", "created_at");
CREATE INDEX "stock_supplies_purchase_order_id_idx" ON "stock_supplies"("purchase_order_id");
ALTER TABLE "stock_supplies" ADD CONSTRAINT "stock_supplies_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_supplies" ADD CONSTRAINT "stock_supplies_to_branch_id_fkey" FOREIGN KEY ("to_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_supplies" ADD CONSTRAINT "stock_supplies_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_transfers" ADD COLUMN "supply_id" UUID;
ALTER TABLE "stock_transfers" ADD COLUMN "unit_rate" DECIMAL(10,2);
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_supply_id_fkey" FOREIGN KEY ("supply_id") REFERENCES "stock_supplies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
