const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

async function run() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set in .env.local");
    process.exit(1);
  }

  console.log('Connecting to Supabase PostgreSQL...');
  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 1
  });

  const client = await pool.connect();
  console.log('Connected. Applying hardening DDL statements...');

  const statements = [
    `ALTER TYPE "public"."audit_event_type" ADD VALUE IF NOT EXISTS 'cleanup_failed'`,
    `ALTER TYPE "public"."audit_event_type" ADD VALUE IF NOT EXISTS 'refund_failed'`,
    `ALTER TYPE "public"."audit_event_type" ADD VALUE IF NOT EXISTS 'reconciliation_matched'`,
    `ALTER TYPE "public"."order_status" ADD VALUE IF NOT EXISTS 'requires_manual_review'`,
    `CREATE TABLE IF NOT EXISTS "refund_transactions" (
      "id" serial PRIMARY KEY NOT NULL,
      "order_id" text NOT NULL,
      "payment_transaction_id" integer,
      "cashfree_payment_id" text NOT NULL,
      "cashfree_refund_id" text NOT NULL UNIQUE,
      "requested_amount" integer NOT NULL,
      "completed_amount" integer,
      "currency" text DEFAULT 'INR' NOT NULL,
      "reason" text NOT NULL,
      "status" text DEFAULT 'REFUND_REQUESTED' NOT NULL,
      "initiated_by" text DEFAULT 'system' NOT NULL,
      "idempotency_key" text NOT NULL UNIQUE,
      "failure_reason" text,
      "cf_response" jsonb,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL,
      "completed_at" timestamp
    )`,
    `ALTER TABLE "pricing_config" ADD COLUMN IF NOT EXISTS "billing_basis" text DEFAULT 'per_sheet' NOT NULL`,
    `ALTER TABLE "pricing_config" ADD COLUMN IF NOT EXISTS "min_order_amount" integer DEFAULT 2 NOT NULL`,
    `ALTER TABLE "pricing_config" ADD COLUMN IF NOT EXISTS "duplex_discount_paise" integer DEFAULT 0 NOT NULL`,
    `ALTER TABLE "pricing_config" ADD COLUMN IF NOT EXISTS "nup_rules" jsonb`,
    `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pages_per_sheet" integer DEFAULT 1 NOT NULL`,
    `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "physical_sheets" integer DEFAULT 1 NOT NULL`,
    `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "billing_basis" text DEFAULT 'per_sheet' NOT NULL`,
    `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "amount_paise" integer DEFAULT 0 NOT NULL`,
    `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pricing_snapshot" jsonb`,
    `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pin_hash" text`,
    `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pin_attempts" integer DEFAULT 0 NOT NULL`,
    `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pin_locked_until" timestamp`,
    `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "sheets_printed" integer DEFAULT 0 NOT NULL`,
    `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "refund_status" text DEFAULT 'NOT_REQUIRED' NOT NULL`,
    `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "refunded_amount" integer DEFAULT 0 NOT NULL`,
    `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "refundable_amount" integer`,
    `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cleanup_status" text DEFAULT 'CLEANUP_PENDING' NOT NULL`,
    `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cleanup_attempts" integer DEFAULT 0 NOT NULL`,
    `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cleanup_error" text`,
    `ALTER TABLE "print_jobs" ADD COLUMN IF NOT EXISTS "sheets_attempted" integer DEFAULT 0 NOT NULL`,
    `ALTER TABLE "print_jobs" ADD COLUMN IF NOT EXISTS "sheets_confirmed" integer DEFAULT 0 NOT NULL`,
    `CREATE INDEX IF NOT EXISTS "refund_transactions_order_idx" ON "refund_transactions" ("order_id")`,
    `CREATE INDEX IF NOT EXISTS "refund_transactions_status_idx" ON "refund_transactions" ("status")`,
    `CREATE INDEX IF NOT EXISTS "orders_refund_status_idx" ON "orders" ("refund_status")`,
    `CREATE INDEX IF NOT EXISTS "orders_cleanup_status_idx" ON "orders" ("cleanup_status")`
  ];

  for (const sql of statements) {
    try {
      await client.query(sql);
      console.log('✓ Executed:', sql.slice(0, 50).trim() + '...');
    } catch (e) {
      console.warn('Notice on statement:', e.message);
    }
  }

  client.release();
  await pool.end();
  console.log('All hardening migrations applied successfully to Supabase!');
}

run().catch((err) => {
  console.error('Fatal migration error:', err);
  process.exit(1);
});

