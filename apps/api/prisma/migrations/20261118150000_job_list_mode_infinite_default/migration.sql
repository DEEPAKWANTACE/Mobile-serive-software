ALTER TABLE "shop_settings" ALTER COLUMN "job_list_mode" SET DEFAULT 'INFINITE';
UPDATE "shop_settings" SET "job_list_mode" = 'INFINITE';
