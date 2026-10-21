-- Job sheet types, two IMEIs, physical-condition proof, repair warranty and manager-approved RWR.
CREATE TYPE "JobType" AS ENUM ('MOBILE', 'ACCESSORY');
ALTER TYPE "JobStatus" ADD VALUE 'RWR_PENDING' BEFORE 'RWR';
ALTER TYPE "PhotoKind" ADD VALUE 'PHYSICAL_CONDITION' BEFORE 'RWR';

ALTER TABLE "branches"
  ADD COLUMN "default_warranty_period" TEXT,
  ADD COLUMN "default_warranty_terms" TEXT;

ALTER TABLE "jobs"
  ADD COLUMN "job_type" "JobType" NOT NULL DEFAULT 'MOBILE',
  ADD COLUMN "accessory_name" TEXT,
  ADD COLUMN "imei2" TEXT,
  ADD COLUMN "physical_condition_remark" TEXT,
  ADD COLUMN "warranty_period" TEXT,
  ADD COLUMN "warranty_terms" TEXT,
  ALTER COLUMN "brand_id" DROP NOT NULL,
  ALTER COLUMN "device_model_id" DROP NOT NULL;

CREATE INDEX "jobs_imei2_idx" ON "jobs"("imei2");

CREATE TABLE "accessory_options" (
  "id" UUID NOT NULL,
  "branch_id" UUID,
  "name" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "accessory_options_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "accessory_options_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "accessory_options_branch_id_name_key" ON "accessory_options"("branch_id", "name");
CREATE INDEX "accessory_options_branch_id_is_active_idx" ON "accessory_options"("branch_id", "is_active");
CREATE UNIQUE INDEX "accessory_options_global_name_key" ON "accessory_options"("name") WHERE "branch_id" IS NULL;

INSERT INTO "accessory_options" ("id", "name", "sort_order", "updated_at") VALUES
  (gen_random_uuid(), 'Charger', 10, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Back Cover', 20, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SIM Tray', 30, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SIM Card', 40, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Memory Card', 50, CURRENT_TIMESTAMP);

-- Branch-specific catalogue rows. Null branch rows are global defaults.
ALTER TABLE "brands" ADD COLUMN "branch_id" UUID;
ALTER TABLE "fault_categories" ADD COLUMN "branch_id" UUID;
ALTER TABLE "faults" ADD COLUMN "branch_id" UUID;
ALTER TABLE "parts" ADD COLUMN "branch_id" UUID, ADD COLUMN "category" TEXT, ADD COLUMN "subcategory" TEXT;

DROP INDEX "brands_name_key";
DROP INDEX "fault_categories_name_key";
DROP INDEX "faults_name_key";
DROP INDEX "parts_code_key";

ALTER TABLE "brands" ADD CONSTRAINT "brands_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fault_categories" ADD CONSTRAINT "fault_categories_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "faults" ADD CONSTRAINT "faults_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "parts" ADD CONSTRAINT "parts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "brands_branch_id_name_key" ON "brands"("branch_id", "name");
CREATE UNIQUE INDEX "fault_categories_branch_id_name_key" ON "fault_categories"("branch_id", "name");
CREATE UNIQUE INDEX "faults_branch_id_name_key" ON "faults"("branch_id", "name");
CREATE UNIQUE INDEX "parts_branch_id_code_key" ON "parts"("branch_id", "code");
CREATE UNIQUE INDEX "brands_global_name_key" ON "brands"("name") WHERE "branch_id" IS NULL;
CREATE UNIQUE INDEX "fault_categories_global_name_key" ON "fault_categories"("name") WHERE "branch_id" IS NULL;
CREATE UNIQUE INDEX "faults_global_name_key" ON "faults"("name") WHERE "branch_id" IS NULL;
CREATE UNIQUE INDEX "parts_global_code_key" ON "parts"("code") WHERE "branch_id" IS NULL;
CREATE INDEX "brands_branch_id_is_active_idx" ON "brands"("branch_id", "is_active");
CREATE INDEX "fault_categories_branch_id_is_active_idx" ON "fault_categories"("branch_id", "is_active");
CREATE INDEX "faults_branch_id_is_active_idx" ON "faults"("branch_id", "is_active");
CREATE INDEX "parts_branch_id_is_active_idx" ON "parts"("branch_id", "is_active");

INSERT INTO "brands" ("id", "name", "created_at", "updated_at")
SELECT gen_random_uuid(), v.name, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES ('Samsung'), ('Apple'), ('Xiaomi'), ('Oppo'), ('Vivo'), ('Realme'), ('OnePlus'), ('Motorola'), ('Nokia'), ('Google'), ('Nothing')) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM "brands" b WHERE b."branch_id" IS NULL AND lower(b."name") = lower(v.name));

INSERT INTO "device_models" ("id", "brand_id", "name", "created_at", "updated_at")
SELECT gen_random_uuid(), b."id", v.model, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('Samsung','Galaxy A15'), ('Samsung','Galaxy A35'), ('Samsung','Galaxy S24'),
  ('Apple','iPhone 13'), ('Apple','iPhone 14'), ('Apple','iPhone 15'),
  ('Xiaomi','Redmi Note 13'), ('Oppo','F27'), ('Vivo','V30'), ('Realme','12 Pro'),
  ('OnePlus','Nord CE 4'), ('Motorola','Edge 50'), ('Google','Pixel 8'), ('Nothing','Phone (2a)')
) AS v(brand, model)
JOIN "brands" b ON b."branch_id" IS NULL AND b."name" = v.brand
WHERE NOT EXISTS (SELECT 1 FROM "device_models" m WHERE m."brand_id" = b."id" AND m."name" = v.model);

INSERT INTO "fault_categories" ("id", "name", "sort_order", "created_at", "updated_at")
SELECT gen_random_uuid(), v.name, v.ord, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES ('Display',10), ('Charging',20), ('Battery',30), ('Audio',40), ('Camera',50), ('Software',60), ('Network',70), ('Physical Damage',80), ('Water Damage',90)) AS v(name,ord)
WHERE NOT EXISTS (SELECT 1 FROM "fault_categories" c WHERE c."branch_id" IS NULL AND c."name" = v.name);

INSERT INTO "faults" ("id", "category_id", "name", "requires_id_proof", "created_at", "updated_at")
SELECT gen_random_uuid(), c."id", v.fault, v.needs_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('Display','Not Glowing',false), ('Display','Broken Glass',false), ('Display','Lines on Screen',false), ('Display','Touch Not Working',false),
  ('Charging','Not Charging',false), ('Charging','Slow Charging',false), ('Battery','Battery Draining',false), ('Battery','Swollen Battery',false),
  ('Audio','Speaker Not Working',false), ('Audio','Microphone Not Working',false), ('Camera','Camera Blurred',false),
  ('Software','Boot Loop',false), ('Software','FRP / Pattern Unlock',true), ('Network','No Network',false),
  ('Physical Damage','Body Damaged',false), ('Water Damage','Liquid Damage',false)
) AS v(category,fault,needs_id)
JOIN "fault_categories" c ON c."branch_id" IS NULL AND c."name" = v.category
WHERE NOT EXISTS (SELECT 1 FROM "faults" f WHERE f."branch_id" IS NULL AND f."name" = v.fault);

INSERT INTO "parts" ("id", "code", "name", "category", "subcategory", "selling_price", "reorder_level", "created_at", "updated_at")
SELECT gen_random_uuid(), v.code, v.name, v.category, v.subcategory, v.price, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('DIS-STD','Display Assembly','Display','Not Glowing',0::numeric),
  ('BAT-STD','Battery','Battery','Low Backup',0::numeric),
  ('CHG-STD','Charging Connector','Charging','Not Charging',0::numeric),
  ('SPK-STD','Loud Speaker','Audio','Speaker Not Working',0::numeric),
  ('MIC-STD','Microphone','Audio','Microphone Not Working',0::numeric)
) AS v(code,name,category,subcategory,price)
WHERE NOT EXISTS (SELECT 1 FROM "parts" p WHERE p."branch_id" IS NULL AND p."code" = v.code);
