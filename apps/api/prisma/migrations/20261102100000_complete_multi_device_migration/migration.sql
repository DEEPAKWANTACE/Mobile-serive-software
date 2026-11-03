-- Non-destructive continuation for installations where the preceding migration
-- created its schema objects before the legacy device backfill encountered NULL accessories.

INSERT INTO "job_devices" (
    "job_id", "sort_order", "job_type", "accessory_name", "brand_id", "device_model_id",
    "manual_brand", "manual_model", "manual_fault", "imei", "imei2", "serial_number", "color",
    "customer_complaint", "accessories", "accessories_other", "condition_notes", "physical_condition_remark",
    "created_at", "updated_at"
)
SELECT
    j."id", 0, j."job_type", j."accessory_name", j."brand_id", j."device_model_id",
    j."manual_brand", j."manual_model", j."manual_fault", j."imei", j."imei2", j."serial_number", j."color",
    j."customer_complaint", COALESCE(j."accessories", ARRAY[]::TEXT[]), j."accessories_other", j."condition_notes", j."physical_condition_remark",
    j."created_at", j."updated_at"
FROM "jobs" j
WHERE NOT EXISTS (
    SELECT 1 FROM "job_devices" d WHERE d."job_id" = j."id" AND d."sort_order" = 0
);

INSERT INTO "job_device_faults" ("job_device_id", "fault_id", "price_label", "price")
SELECT d."id", f."fault_id", f."price_label", f."price"
FROM "job_devices" d
JOIN "job_faults" f ON f."job_id" = d."job_id"
WHERE d."sort_order" = 0
ON CONFLICT ("job_device_id", "fault_id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "diagnosis_findings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "diagnosis_findings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "job_diagnosis_findings" (
    "job_id" UUID NOT NULL,
    "diagnosis_finding_id" UUID NOT NULL,
    "label_snapshot" TEXT NOT NULL,
    CONSTRAINT "job_diagnosis_findings_pkey" PRIMARY KEY ("job_id", "diagnosis_finding_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "diagnosis_findings_label_key" ON "diagnosis_findings"("label");
CREATE INDEX IF NOT EXISTS "diagnosis_findings_is_active_sort_order_idx" ON "diagnosis_findings"("is_active", "sort_order");
CREATE INDEX IF NOT EXISTS "job_diagnosis_findings_diagnosis_finding_id_idx" ON "job_diagnosis_findings"("diagnosis_finding_id");

DO $$ BEGIN
    ALTER TABLE "job_diagnosis_findings" ADD CONSTRAINT "job_diagnosis_findings_job_id_fkey"
    FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "job_diagnosis_findings" ADD CONSTRAINT "job_diagnosis_findings_diagnosis_finding_id_fkey"
    FOREIGN KEY ("diagnosis_finding_id") REFERENCES "diagnosis_findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

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
('10000000-0000-4000-8000-000000000010', 'No power / dead device', 100)
ON CONFLICT ("label") DO NOTHING;
