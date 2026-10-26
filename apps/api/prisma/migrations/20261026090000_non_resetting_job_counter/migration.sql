-- Continue job-sheet numbering from one non-resetting counter shared by all branches.
-- Legacy job numbers may contain branch/month prefixes; take their trailing serial.
INSERT INTO "job_global_counters" ("period", "last_seq")
SELECT
  'GLOBAL',
  COALESCE(MAX((substring("job_number" from '([0-9]+)$'))::INTEGER), 0)
FROM "jobs"
ON CONFLICT ("period") DO UPDATE
SET "last_seq" = GREATEST("job_global_counters"."last_seq", EXCLUDED."last_seq");
