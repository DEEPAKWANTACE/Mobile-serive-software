-- CreateEnum
CREATE TYPE "StockTransferStatus" AS ENUM ('SENT', 'RECEIVED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockMovementType" ADD VALUE 'TRANSFER_OUT';
ALTER TYPE "StockMovementType" ADD VALUE 'TRANSFER_IN';

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "from_branch_id" UUID NOT NULL,
    "to_branch_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "StockTransferStatus" NOT NULL DEFAULT 'SENT',
    "note" TEXT,
    "sent_by_id" UUID NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_by_id" UUID,
    "received_at" TIMESTAMP(3),

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "shop_name" TEXT NOT NULL,
    "legal_name" TEXT,
    "gstin" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "logo_key" TEXT,
    "invoice_terms" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_transfers_to_branch_id_status_idx" ON "stock_transfers"("to_branch_id", "status");

-- CreateIndex
CREATE INDEX "stock_transfers_from_branch_id_status_idx" ON "stock_transfers"("from_branch_id", "status");

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_branch_id_fkey" FOREIGN KEY ("from_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_branch_id_fkey" FOREIGN KEY ("to_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_sent_by_id_fkey" FOREIGN KEY ("sent_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

