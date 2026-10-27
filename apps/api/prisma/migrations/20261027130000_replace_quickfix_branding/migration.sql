UPDATE "shop_settings"
SET
  "shop_name" = 'Dattagaru Mobile Shopee',
  "legal_name" = 'Dattagaru Mobile Shopee',
  "email" = CASE
    WHEN "email" ILIKE '%@quickfix.example' THEN 'dattagurumobile12345@gmail.com'
    ELSE "email"
  END,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = 'default'
  AND (
    "shop_name" ILIKE '%quickfix%'
    OR "shop_name" ILIKE '%dattaguru%'
    OR "legal_name" ILIKE '%quickfix%'
  );

UPDATE "users"
SET "email" = regexp_replace("email", '@quickfix\.example$', '@dattagaru.example', 'i')
WHERE "email" ILIKE '%@quickfix.example';
