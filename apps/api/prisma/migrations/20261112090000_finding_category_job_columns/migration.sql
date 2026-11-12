-- Diagnosis findings are grouped as hardware or software in the engineer's diagnosis popup.
CREATE TYPE "DiagnosisFindingCategory" AS ENUM ('HARDWARE', 'SOFTWARE');
ALTER TABLE "diagnosis_findings" ADD COLUMN "category" "DiagnosisFindingCategory" NOT NULL DEFAULT 'HARDWARE';

UPDATE "diagnosis_findings" SET "category" = 'SOFTWARE'
WHERE "id" = '10000000-0000-4000-8000-000000000005';

INSERT INTO "diagnosis_findings" ("id", "label", "category", "sort_order", "updated_at") VALUES
('10000000-0000-4000-8000-000000000011', 'Phone stuck on logo / boot loop', 'SOFTWARE', 110, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000012', 'Pattern / password / FRP lock', 'SOFTWARE', 120, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000013', 'Firmware flash / OS reinstall needed', 'SOFTWARE', 130, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000014', 'Virus / unwanted apps / slow phone', 'SOFTWARE', 140, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000015', 'Network / IMEI software issue', 'SOFTWARE', 150, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000016', 'App crash / update failure', 'SOFTWARE', 160, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000017', 'Charging port loose or dirty', 'HARDWARE', 170, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000018', 'Back panel / frame damaged', 'HARDWARE', 180, CURRENT_TIMESTAMP),
('10000000-0000-4000-8000-000000000019', 'Power / volume button fault', 'HARDWARE', 190, CURRENT_TIMESTAMP)
ON CONFLICT ("label") DO NOTHING;

-- Per-role job sheet list columns (null = built-in defaults).
ALTER TABLE "shop_settings" ADD COLUMN "job_list_columns" JSONB;
