-- Repeat repair: a new job sheet can be started from an earlier one.
ALTER TABLE "jobs" ADD COLUMN "repeat_of_job_id" UUID;
CREATE INDEX "jobs_repeat_of_job_id_idx" ON "jobs"("repeat_of_job_id");
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_repeat_of_job_id_fkey"
FOREIGN KEY ("repeat_of_job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CCO costing: warranty per item; invoices keep the part code and warranty of each line.
ALTER TABLE "job_estimate_lines" ADD COLUMN "warranty" TEXT;
ALTER TABLE "invoice_lines" ADD COLUMN "part_code" TEXT;
ALTER TABLE "invoice_lines" ADD COLUMN "warranty" TEXT;

-- Diagnosis presets: problem type → sub category → finding.
CREATE TABLE "diagnosis_finding_subcategories" (
    "id" UUID NOT NULL,
    "type_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "diagnosis_finding_subcategories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "diagnosis_finding_subcategories_type_id_name_key" ON "diagnosis_finding_subcategories"("type_id", "name");
ALTER TABLE "diagnosis_finding_subcategories" ADD CONSTRAINT "diagnosis_finding_subcategories_type_id_fkey"
FOREIGN KEY ("type_id") REFERENCES "diagnosis_finding_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "diagnosis_findings" ADD COLUMN "subcategory_id" UUID;
CREATE INDEX "diagnosis_findings_subcategory_id_idx" ON "diagnosis_findings"("subcategory_id");
ALTER TABLE "diagnosis_findings" ADD CONSTRAINT "diagnosis_findings_subcategory_id_fkey"
FOREIGN KEY ("subcategory_id") REFERENCES "diagnosis_finding_subcategories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Default sub categories for the seeded Hardware / Software types (skipped if a type was removed).
INSERT INTO "diagnosis_finding_subcategories" ("id", "type_id", "name", "sort_order", "updated_at")
SELECT v.id::uuid, v.type_id::uuid, v.name, v.sort_order, CURRENT_TIMESTAMP
FROM (VALUES
    ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Display & touch', 10),
    ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Battery & charging', 20),
    ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'Motherboard / IC', 30),
    ('30000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', 'Speaker & microphone', 40),
    ('30000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001', 'Camera', 50),
    ('30000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000001', 'Body, buttons & ports', 60),
    ('30000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000001', 'Liquid / physical damage', 70),
    ('30000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000002', 'OS / firmware', 10),
    ('30000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000002', 'Locks / FRP', 20),
    ('30000000-0000-4000-8000-000000000013', '20000000-0000-4000-8000-000000000002', 'Apps & performance', 30),
    ('30000000-0000-4000-8000-000000000014', '20000000-0000-4000-8000-000000000002', 'Network / IMEI', 40)
) AS v(id, type_id, name, sort_order)
WHERE EXISTS (SELECT 1 FROM "diagnosis_finding_types" t WHERE t.id = v.type_id::uuid)
ON CONFLICT ("type_id", "name") DO NOTHING;

-- Put the seeded findings into their sub category (only where the type still matches).
UPDATE "diagnosis_findings" f
SET "subcategory_id" = s.id
FROM (VALUES
    ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001'),
    ('10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001'),
    ('10000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002'),
    ('10000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000002'),
    ('10000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000011'),
    ('10000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000007'),
    ('10000000-0000-4000-8000-000000000007', '30000000-0000-4000-8000-000000000003'),
    ('10000000-0000-4000-8000-000000000008', '30000000-0000-4000-8000-000000000005'),
    ('10000000-0000-4000-8000-000000000009', '30000000-0000-4000-8000-000000000004'),
    ('10000000-0000-4000-8000-000000000010', '30000000-0000-4000-8000-000000000003'),
    ('10000000-0000-4000-8000-000000000011', '30000000-0000-4000-8000-000000000011'),
    ('10000000-0000-4000-8000-000000000012', '30000000-0000-4000-8000-000000000012'),
    ('10000000-0000-4000-8000-000000000013', '30000000-0000-4000-8000-000000000011'),
    ('10000000-0000-4000-8000-000000000014', '30000000-0000-4000-8000-000000000013'),
    ('10000000-0000-4000-8000-000000000015', '30000000-0000-4000-8000-000000000014'),
    ('10000000-0000-4000-8000-000000000016', '30000000-0000-4000-8000-000000000013'),
    ('10000000-0000-4000-8000-000000000017', '30000000-0000-4000-8000-000000000002'),
    ('10000000-0000-4000-8000-000000000018', '30000000-0000-4000-8000-000000000006'),
    ('10000000-0000-4000-8000-000000000019', '30000000-0000-4000-8000-000000000006')
) AS m(finding_id, subcategory_id)
JOIN "diagnosis_finding_subcategories" s ON s.id = m.subcategory_id::uuid
WHERE f.id = m.finding_id::uuid AND f.type_id = s.type_id;

-- A few more common findings so every default sub category has options.
INSERT INTO "diagnosis_findings" ("id", "label", "type_id", "subcategory_id", "sort_order", "updated_at")
SELECT v.id::uuid, v.label, s.type_id, s.id, v.sort_order, CURRENT_TIMESTAMP
FROM (VALUES
    ('10000000-0000-4000-8000-000000000021', 'Display lines / flickering', '30000000-0000-4000-8000-000000000001', 210),
    ('10000000-0000-4000-8000-000000000022', 'Battery swollen', '30000000-0000-4000-8000-000000000002', 220),
    ('10000000-0000-4000-8000-000000000023', 'Charging IC fault', '30000000-0000-4000-8000-000000000003', 230),
    ('10000000-0000-4000-8000-000000000024', 'Earpiece not working', '30000000-0000-4000-8000-000000000004', 240),
    ('10000000-0000-4000-8000-000000000025', 'Camera glass broken', '30000000-0000-4000-8000-000000000005', 250),
    ('10000000-0000-4000-8000-000000000026', 'SIM tray / SIM slot fault', '30000000-0000-4000-8000-000000000006', 260),
    ('10000000-0000-4000-8000-000000000027', 'Phone dropped — internal damage', '30000000-0000-4000-8000-000000000007', 270),
    ('10000000-0000-4000-8000-000000000028', 'Google account / Mi account lock', '30000000-0000-4000-8000-000000000012', 280),
    ('10000000-0000-4000-8000-000000000029', 'Storage full / data backup needed', '30000000-0000-4000-8000-000000000013', 290),
    ('10000000-0000-4000-8000-000000000030', 'No network / emergency calls only', '30000000-0000-4000-8000-000000000014', 300)
) AS v(id, label, subcategory_id, sort_order)
JOIN "diagnosis_finding_subcategories" s ON s.id = v.subcategory_id::uuid
ON CONFLICT ("label") DO NOTHING;
