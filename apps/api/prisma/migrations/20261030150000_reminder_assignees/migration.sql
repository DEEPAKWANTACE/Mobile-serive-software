ALTER TABLE "reminders" ADD COLUMN "assigned_to_id" UUID;

UPDATE "reminders" SET "assigned_to_id" = "created_by_id";

ALTER TABLE "reminders" ALTER COLUMN "assigned_to_id" SET NOT NULL;

CREATE INDEX "reminders_assigned_to_id_completed_at_due_at_idx"
ON "reminders"("assigned_to_id", "completed_at", "due_at");

ALTER TABLE "reminders"
ADD CONSTRAINT "reminders_assigned_to_id_fkey"
FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
