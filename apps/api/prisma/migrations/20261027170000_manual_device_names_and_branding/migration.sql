ALTER TABLE "jobs"
ADD COLUMN "manual_brand" TEXT,
ADD COLUMN "manual_model" TEXT;

UPDATE "shop_settings"
SET
  "shop_name" = replace("shop_name", 'Dattagaru Mobile Shopee', 'Dattagaru Mobile'),
  "legal_name" = replace("legal_name", 'Dattagaru Mobile Shopee', 'Dattagaru Mobile')
WHERE "shop_name" ILIKE '%Dattagaru Mobile Shopee%'
   OR "legal_name" ILIKE '%Dattagaru Mobile Shopee%';
