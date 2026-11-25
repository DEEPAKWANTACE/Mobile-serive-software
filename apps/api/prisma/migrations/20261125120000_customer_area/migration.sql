-- Customer area: State -> District -> City/Taluka (existing "city") -> Gaon.
ALTER TABLE "customers" ADD COLUMN "state" TEXT;
ALTER TABLE "customers" ADD COLUMN "district" TEXT;
ALTER TABLE "customers" ADD COLUMN "village" TEXT;

-- Show City and Gaon in the job list for CCO and above, including where Super Admin already saved a column choice.
UPDATE "shop_settings" AS s
SET "job_list_columns" = jsonb_set(
  s."job_list_columns"::jsonb,
  ARRAY[r.role],
  (s."job_list_columns"::jsonb -> r.role)
    || CASE WHEN (s."job_list_columns"::jsonb -> r.role) ? 'city' THEN '[]'::jsonb ELSE '["city"]'::jsonb END
    || CASE WHEN (s."job_list_columns"::jsonb -> r.role) ? 'village' THEN '[]'::jsonb ELSE '["village"]'::jsonb END
)
FROM (VALUES ('CCO')) AS r(role)
WHERE jsonb_typeof(s."job_list_columns"::jsonb -> r.role) = 'array';

UPDATE "shop_settings" AS s
SET "job_list_columns" = jsonb_set(
  s."job_list_columns"::jsonb,
  ARRAY[r.role],
  (s."job_list_columns"::jsonb -> r.role)
    || CASE WHEN (s."job_list_columns"::jsonb -> r.role) ? 'city' THEN '[]'::jsonb ELSE '["city"]'::jsonb END
    || CASE WHEN (s."job_list_columns"::jsonb -> r.role) ? 'village' THEN '[]'::jsonb ELSE '["village"]'::jsonb END
)
FROM (VALUES ('BRANCH_MANAGER')) AS r(role)
WHERE jsonb_typeof(s."job_list_columns"::jsonb -> r.role) = 'array';

UPDATE "shop_settings" AS s
SET "job_list_columns" = jsonb_set(
  s."job_list_columns"::jsonb,
  ARRAY[r.role],
  (s."job_list_columns"::jsonb -> r.role)
    || CASE WHEN (s."job_list_columns"::jsonb -> r.role) ? 'city' THEN '[]'::jsonb ELSE '["city"]'::jsonb END
    || CASE WHEN (s."job_list_columns"::jsonb -> r.role) ? 'village' THEN '[]'::jsonb ELSE '["village"]'::jsonb END
)
FROM (VALUES ('SUPER_ADMIN')) AS r(role)
WHERE jsonb_typeof(s."job_list_columns"::jsonb -> r.role) = 'array';
