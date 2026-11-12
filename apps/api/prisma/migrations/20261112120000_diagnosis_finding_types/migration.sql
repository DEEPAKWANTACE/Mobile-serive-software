-- Problem types become an editable master list instead of a fixed Hardware/Software enum.
CREATE TABLE "diagnosis_finding_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diagnosis_finding_types_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "diagnosis_finding_types_name_key" ON "diagnosis_finding_types"("name");

INSERT INTO "diagnosis_finding_types" ("id", "name", "sort_order") VALUES
('20000000-0000-4000-8000-000000000001', 'Hardware', 10),
('20000000-0000-4000-8000-000000000002', 'Software', 20);

ALTER TABLE "diagnosis_findings" ADD COLUMN "type_id" UUID;
UPDATE "diagnosis_findings" SET "type_id" = CASE "category"
    WHEN 'SOFTWARE' THEN '20000000-0000-4000-8000-000000000002'::uuid
    ELSE '20000000-0000-4000-8000-000000000001'::uuid
END;
ALTER TABLE "diagnosis_findings" ALTER COLUMN "type_id" SET NOT NULL;
CREATE INDEX "diagnosis_findings_type_id_idx" ON "diagnosis_findings"("type_id");
ALTER TABLE "diagnosis_findings" ADD CONSTRAINT "diagnosis_findings_type_id_fkey"
FOREIGN KEY ("type_id") REFERENCES "diagnosis_finding_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "diagnosis_findings" DROP COLUMN "category";
DROP TYPE "DiagnosisFindingCategory";
