-- Job numbers are sequenced across all branches (per month), so no two branches share a serial.
CREATE TABLE "job_global_counters" (
    "period" TEXT NOT NULL,
    "last_seq" INTEGER NOT NULL,
    CONSTRAINT "job_global_counters_pkey" PRIMARY KEY ("period")
);

INSERT INTO "job_global_counters" ("period", "last_seq")
SELECT "period", MAX("last_seq") FROM "job_counters" GROUP BY "period";
