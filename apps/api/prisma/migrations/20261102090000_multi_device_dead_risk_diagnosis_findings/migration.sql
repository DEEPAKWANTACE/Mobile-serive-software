-- Customer/retailer source and dead-device risk acknowledgement.
CREATE TYPE "JobCustomerType" AS ENUM ('CUSTOMER', 'RETAILER');

ALTER TABLE "jobs"
ADD COLUMN "customer_type" "JobCustomerType" NOT NULL DEFAULT 'CUSTOMER',
ADD COLUMN "dead_risk_requested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "dead_risk_note" TEXT,
ADD COLUMN "dead_risk_approved_at" TIMESTAMP(3),
ADD COLUMN "dead_risk_approved_by_id" UUID;

UPDATE "jobs"
SET "customer_type" = 'RETAILER'
WHERE NULLIF(BTRIM("retailer"), '') IS NOT NULL;

ALTER TABLE "jobs"
ADD CONSTRAINT "jobs_dead_risk_approved_by_id_fkey"
FOREIGN KEY ("dead_risk_approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Multiple devices/accessories under one job sheet. Existing top-level columns are kept as
-- a backwards-compatible snapshot of the first device.
CREATE TABLE "job_devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "job_type" "JobType" NOT NULL DEFAULT 'MOBILE',
    "accessory_name" TEXT,
    "brand_id" UUID,
    "device_model_id" UUID,
    "manual_brand" TEXT,
    "manual_model" TEXT,
    "manual_fault" TEXT,
    "imei" TEXT,
    "imei2" TEXT,
    "serial_number" TEXT,
    "color" TEXT,
    "customer_complaint" TEXT,
    "accessories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "accessories_other" TEXT,
    "condition_notes" TEXT,
    "physical_condition_remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_devices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "job_device_faults" (
    "job_device_id" UUID NOT NULL,
    "fault_id" UUID NOT NULL,
    "price_label" TEXT,
    "price" DECIMAL(10,2),

    CONSTRAINT "job_device_faults_pkey" PRIMARY KEY ("job_device_id", "fault_id")
);

CREATE INDEX "job_devices_job_id_sort_order_idx" ON "job_devices"("job_id", "sort_order");
CREATE INDEX "job_devices_device_model_id_idx" ON "job_devices"("device_model_id");
CREATE INDEX "job_devices_imei_idx" ON "job_devices"("imei");

ALTER TABLE "job_devices" ADD CONSTRAINT "job_devices_job_id_fkey"
FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_devices" ADD CONSTRAINT "job_devices_brand_id_fkey"
FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "job_devices" ADD CONSTRAINT "job_devices_device_model_id_fkey"
FOREIGN KEY ("device_model_id") REFERENCES "device_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "job_device_faults" ADD CONSTRAINT "job_device_faults_job_device_id_fkey"
FOREIGN KEY ("job_device_id") REFERENCES "job_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_device_faults" ADD CONSTRAINT "job_device_faults_fault_id_fkey"
FOREIGN KEY ("fault_id") REFERENCES "faults"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "job_devices" (
    "job_id", "sort_order", "job_type", "accessory_name", "brand_id", "device_model_id",
    "manual_brand", "manual_model", "manual_fault", "imei", "imei2", "serial_number", "color",
    "customer_complaint", "accessories", "accessories_other", "condition_notes", "physical_condition_remark",
    "created_at", "updated_at"
)
SELECT
    "id", 0, "job_type", "accessory_name", "brand_id", "device_model_id",
    "manual_brand", "manual_model", "manual_fault", "imei", "imei2", "serial_number", "color",
    "customer_complaint", COALESCE("accessories", ARRAY[]::TEXT[]), "accessories_other", "condition_notes", "physical_condition_remark",
    "created_at", "updated_at"
FROM "jobs";

INSERT INTO "job_device_faults" ("job_device_id", "fault_id", "price_label", "price")
SELECT d."id", f."fault_id", f."price_label", f."price"
FROM "job_devices" d
JOIN "job_faults" f ON f."job_id" = d."job_id"
WHERE d."sort_order" = 0;

-- Diagnosis finding master and per-job selections.
CREATE TABLE "diagnosis_findings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diagnosis_findings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "job_diagnosis_findings" (
    "job_id" UUID NOT NULL,
    "diagnosis_finding_id" UUID NOT NULL,
    "label_snapshot" TEXT NOT NULL,

    CONSTRAINT "job_diagnosis_findings_pkey" PRIMARY KEY ("job_id", "diagnosis_finding_id")
);

CREATE UNIQUE INDEX "diagnosis_findings_label_key" ON "diagnosis_findings"("label");
CREATE INDEX "diagnosis_findings_is_active_sort_order_idx" ON "diagnosis_findings"("is_active", "sort_order");
CREATE INDEX "job_diagnosis_findings_diagnosis_finding_id_idx" ON "job_diagnosis_findings"("diagnosis_finding_id");

ALTER TABLE "job_diagnosis_findings" ADD CONSTRAINT "job_diagnosis_findings_job_id_fkey"
FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_diagnosis_findings" ADD CONSTRAINT "job_diagnosis_findings_diagnosis_finding_id_fkey"
FOREIGN KEY ("diagnosis_finding_id") REFERENCES "diagnosis_findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "diagnosis_findings" ("id", "label", "sort_order") VALUES
('10000000-0000-4000-8000-000000000001', 'Display assembly damaged', 10),
('10000000-0000-4000-8000-000000000002', 'Touch not responding', 20),
('10000000-0000-4000-8000-000000000003', 'Battery health degraded', 30),
('10000000-0000-4000-8000-000000000004', 'Charging section fault', 40),
('10000000-0000-4000-8000-000000000005', 'Software / operating system issue', 50),
('10000000-0000-4000-8000-000000000006', 'Liquid damage or corrosion found', 60),
('10000000-0000-4000-8000-000000000007', 'Motherboard / IC-level fault', 70),
('10000000-0000-4000-8000-000000000008', 'Camera module fault', 80),
('10000000-0000-4000-8000-000000000009', 'Speaker or microphone fault', 90),
('10000000-0000-4000-8000-000000000010', 'No power / dead device', 100);
