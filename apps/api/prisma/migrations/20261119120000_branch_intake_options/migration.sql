-- Per-branch job sheet / delivery options (Branch Manager or Super Admin can toggle).
ALTER TABLE "branches" ADD COLUMN "allow_manual_device" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "branches" ADD COLUMN "allow_imei_na" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "branches" ADD COLUMN "require_imei_at_delivery" BOOLEAN NOT NULL DEFAULT true;
