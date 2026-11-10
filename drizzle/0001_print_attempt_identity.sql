-- PrintBar Migration 0001: Individual Print-Attempt Identity & Unique CUPS Job Ownership
-- Ensures every print attempt has a durable unique identifier (attempt_id),
-- sequential order attempt number (attempt_no), document linkage (doc_id),
-- lifecycle status, and strict uniqueness on (device_id, cups_job_id).

ALTER TABLE "device_print_jobs" ADD COLUMN IF NOT EXISTS "attempt_id" text;
ALTER TABLE "device_print_jobs" ADD COLUMN IF NOT EXISTS "attempt_no" integer NOT NULL DEFAULT 1;
ALTER TABLE "device_print_jobs" ADD COLUMN IF NOT EXISTS "doc_id" text;
ALTER TABLE "device_print_jobs" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'queued';

-- Backfill any pre-existing legacy rows safely before applying NOT NULL / UNIQUE
UPDATE "device_print_jobs"
SET "attempt_id" = COALESCE("attempt_id", 'ATT-LEGACY-' || "id"::text)
WHERE "attempt_id" IS NULL;

-- Normalize legacy typo column pagesconfirmed -> pages_confirmed if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'device_print_jobs' AND column_name = 'pagesconfirmed'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'device_print_jobs' AND column_name = 'pages_confirmed'
  ) THEN
    ALTER TABLE "device_print_jobs" RENAME COLUMN "pagesconfirmed" TO "pages_confirmed";
  END IF;
END $$;

ALTER TABLE "device_print_jobs" ALTER COLUMN "attempt_id" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "dpj_attempt_id_uidx"
  ON "device_print_jobs" ("attempt_id");

CREATE UNIQUE INDEX IF NOT EXISTS "dpj_order_attempt_no_uidx"
  ON "device_print_jobs" ("order_id", "attempt_no");

CREATE UNIQUE INDEX IF NOT EXISTS "dpj_device_cups_uidx"
  ON "device_print_jobs" ("device_id", "cups_job_id")
  WHERE "cups_job_id" IS NOT NULL;

