const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });

async function run() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set in .env.local");
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  console.log("Connected to Supabase PostgreSQL. Applying admin dashboard schema...");

  await client.query(`
    -- admin_users schema adjustment
    ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS email text UNIQUE;
    ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS name text;
    ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS role text DEFAULT 'super_admin';
    ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;
    ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS must_change_password boolean DEFAULT false;
    ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS notify_prefs jsonb DEFAULT '{}'::jsonb;
    ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS failed_logins integer DEFAULT 0;
    ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS locked_until timestamp with time zone;

    -- admin_sessions
    CREATE TABLE IF NOT EXISTS admin_sessions (
      id text PRIMARY KEY,
      user_id integer NOT NULL,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
      expires_at timestamp with time zone NOT NULL,
      ip text,
      user_agent text,
      revoked_at timestamp with time zone
    );
    CREATE INDEX IF NOT EXISTS admin_sessions_user_idx ON admin_sessions (user_id);

    -- audit_logs
    CREATE TABLE IF NOT EXISTS audit_logs (
      id serial PRIMARY KEY,
      user_id integer,
      user_name text,
      role text,
      action text NOT NULL,
      entity text,
      entity_id text,
      details jsonb DEFAULT '{}'::jsonb,
      ip text,
      created_at timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_logs (created_at);
    CREATE INDEX IF NOT EXISTS audit_action_idx ON audit_logs (action);

    -- settings
    CREATE TABLE IF NOT EXISTS settings (
      key text PRIMARY KEY,
      value jsonb NOT NULL,
      updated_at timestamp with time zone DEFAULT now() NOT NULL,
      updated_by_name text
    );

    -- push_subscriptions
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id serial PRIMARY KEY,
      user_id integer NOT NULL,
      endpoint text NOT NULL UNIQUE,
      p256dh text NOT NULL,
      auth text NOT NULL,
      user_agent text,
      created_at timestamp with time zone DEFAULT now() NOT NULL
    );

    -- kiosks
    CREATE TABLE IF NOT EXISTS kiosks (
      id text PRIMARY KEY,
      name text NOT NULL,
      location text NOT NULL,
      enabled boolean DEFAULT true NOT NULL,
      maintenance boolean DEFAULT false NOT NULL,
      printing_paused boolean DEFAULT false NOT NULL,
      last_heartbeat timestamp with time zone,
      software_version text,
      network_type text,
      ip_address text,
      backend_connected boolean DEFAULT false NOT NULL,
      pi_temp_c integer,
      pi_cpu_pct integer,
      pi_mem_pct integer,
      disk_pct integer,
      ups_status text,
      config jsonb DEFAULT '{}'::jsonb NOT NULL,
      is_demo boolean DEFAULT false NOT NULL,
      created_at timestamp with time zone DEFAULT now() NOT NULL
    );

    -- printers
    CREATE TABLE IF NOT EXISTS printers (
      id text PRIMARY KEY,
      kiosk_id text NOT NULL,
      name text NOT NULL,
      model text NOT NULL,
      ip text,
      cups_queue text,
      role text DEFAULT 'primary' NOT NULL,
      priority integer DEFAULT 1 NOT NULL,
      enabled boolean DEFAULT true NOT NULL,
      paused boolean DEFAULT false NOT NULL,
      auto_failover boolean DEFAULT true NOT NULL,
      supports_color boolean DEFAULT false NOT NULL,
      connected boolean DEFAULT false NOT NULL,
      state text DEFAULT 'offline' NOT NULL,
      error_code text,
      error_message text,
      paper_capacity integer DEFAULT 250 NOT NULL,
      paper_remaining integer,
      paper_source text DEFAULT 'estimated' NOT NULL,
      toner_black integer,
      toner_color integer,
      toner_source text DEFAULT 'unsupported' NOT NULL,
      drum_life integer,
      drum_source text DEFAULT 'unsupported' NOT NULL,
      total_pages integer DEFAULT 0 NOT NULL,
      last_successful_print_at timestamp with time zone,
      last_heartbeat timestamp with time zone,
      is_demo boolean DEFAULT false NOT NULL,
      created_at timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS printers_kiosk_idx ON printers (kiosk_id);

    -- printer_events
    CREATE TABLE IF NOT EXISTS printer_events (
      id serial PRIMARY KEY,
      printer_id text NOT NULL,
      kind text NOT NULL,
      code text,
      message text NOT NULL,
      created_at timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS printer_events_printer_idx ON printer_events (printer_id, created_at);

    -- maintenance_records
    CREATE TABLE IF NOT EXISTS maintenance_records (
      id serial PRIMARY KEY,
      printer_id text NOT NULL,
      type text NOT NULL,
      note text,
      cost_paise integer DEFAULT 0 NOT NULL,
      performed_by text,
      created_at timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS maint_printer_idx ON maintenance_records (printer_id);

    -- connectivity_events
    CREATE TABLE IF NOT EXISTS connectivity_events (
      id serial PRIMARY KEY,
      kiosk_id text NOT NULL,
      kind text NOT NULL,
      detail text,
      created_at timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS conn_kiosk_idx ON connectivity_events (kiosk_id, created_at);

    -- kiosk_logs
    CREATE TABLE IF NOT EXISTS kiosk_logs (
      id serial PRIMARY KEY,
      kiosk_id text NOT NULL,
      level text DEFAULT 'info' NOT NULL,
      source text DEFAULT 'agent' NOT NULL,
      message text NOT NULL,
      created_at timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS kiosk_logs_idx ON kiosk_logs (kiosk_id, created_at);

    -- device_commands
    CREATE TABLE IF NOT EXISTS device_commands (
      id serial PRIMARY KEY,
      kiosk_id text NOT NULL,
      printer_id text,
      command text NOT NULL,
      payload jsonb DEFAULT '{}'::jsonb,
      idempotency_key text NOT NULL UNIQUE,
      status text DEFAULT 'queued' NOT NULL,
      result text,
      requested_by text,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      delivered_at timestamp with time zone,
      completed_at timestamp with time zone
    );
    CREATE INDEX IF NOT EXISTS device_commands_kiosk_idx ON device_commands (kiosk_id, status);

    -- device_print_jobs (preserves original hardware print logs)
    CREATE TABLE IF NOT EXISTS device_print_jobs (
      id serial PRIMARY KEY,
      order_id text NOT NULL,
      job_ref text NOT NULL,
      device_id text NOT NULL,
      printer_name text NOT NULL,
      cups_job_id text,
      is_fallback boolean DEFAULT false NOT NULL,
      pages_attempted integer DEFAULT 0 NOT NULL,
      pagesConfirmed integer DEFAULT 0 NOT NULL,
      sheets_attempted integer DEFAULT 0 NOT NULL,
      sheets_confirmed integer DEFAULT 0 NOT NULL,
      started_at timestamp without time zone DEFAULT now() NOT NULL,
      completed_at timestamp without time zone,
      failed_at timestamp without time zone,
      failure_reason text,
      cups_status text,
      retry_count integer DEFAULT 0 NOT NULL,
      notes text
    );

    -- print_jobs (if existing had integer id, recreate/align for admin dashboard)
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'print_jobs' AND column_name = 'id' AND data_type = 'integer'
      ) THEN
        ALTER TABLE print_jobs RENAME TO legacy_print_jobs;
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS print_jobs (
      id text PRIMARY KEY,
      customer_ref text NOT NULL,
      file_name text NOT NULL,
      pages integer NOT NULL,
      color_mode text NOT NULL,
      sided text NOT NULL,
      pages_per_sheet integer DEFAULT 1 NOT NULL,
      copies integer DEFAULT 1 NOT NULL,
      amount_paise integer NOT NULL,
      payment_status text DEFAULT 'pending' NOT NULL,
      status text NOT NULL,
      kiosk_id text,
      printer_id text,
      pages_printed integer DEFAULT 0 NOT NULL,
      error_code text,
      error_message text,
      retry_count integer DEFAULT 0 NOT NULL,
      document_deleted_at timestamp with time zone,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      updated_at timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS jobs_created_idx ON print_jobs (created_at);
    CREATE INDEX IF NOT EXISTS jobs_status_idx ON print_jobs (status);
    CREATE INDEX IF NOT EXISTS jobs_customer_idx ON print_jobs (customer_ref);

    -- print_attempts
    CREATE TABLE IF NOT EXISTS print_attempts (
      id serial PRIMARY KEY,
      job_id text NOT NULL,
      attempt_no integer NOT NULL,
      printer_id text,
      status text NOT NULL,
      pages_printed integer DEFAULT 0 NOT NULL,
      cups_job_id text,
      error text,
      started_at timestamp with time zone DEFAULT now() NOT NULL,
      ended_at timestamp with time zone
    );
    CREATE UNIQUE INDEX IF NOT EXISTS attempts_job_no ON print_attempts (job_id, attempt_no);

    -- job_logs
    CREATE TABLE IF NOT EXISTS job_logs (
      id serial PRIMARY KEY,
      job_id text NOT NULL,
      level text DEFAULT 'info' NOT NULL,
      message text NOT NULL,
      created_at timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS job_logs_idx ON job_logs (job_id, created_at);

    -- payments
    CREATE TABLE IF NOT EXISTS payments (
      id serial PRIMARY KEY,
      job_id text NOT NULL,
      order_id text NOT NULL UNIQUE,
      transaction_id text,
      amount_paise integer NOT NULL,
      fee_paise integer DEFAULT 0 NOT NULL,
      method text,
      status text DEFAULT 'pending' NOT NULL,
      refunded_paise integer DEFAULT 0 NOT NULL,
      customer_status text,
      failure_reason text,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      paid_at timestamp with time zone,
      reconciled_at timestamp with time zone
    );
    CREATE INDEX IF NOT EXISTS payments_job_idx ON payments (job_id);
    CREATE INDEX IF NOT EXISTS payments_created_idx ON payments (created_at);

    -- refunds
    CREATE TABLE IF NOT EXISTS refunds (
      id serial PRIMARY KEY,
      refund_ref text NOT NULL UNIQUE,
      payment_id integer NOT NULL,
      job_id text NOT NULL,
      amount_paise integer NOT NULL,
      type text NOT NULL,
      reason text NOT NULL,
      status text DEFAULT 'requested' NOT NULL,
      gateway_refund_id text,
      gateway_status text,
      gateway_message text,
      initiated_by text,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      updated_at timestamp with time zone DEFAULT now() NOT NULL,
      completed_at timestamp with time zone
    );
    CREATE INDEX IF NOT EXISTS refunds_payment_idx ON refunds (payment_id);

    -- alerts
    CREATE TABLE IF NOT EXISTS alerts (
      id serial PRIMARY KEY,
      kiosk_id text,
      printer_id text,
      type text NOT NULL,
      severity text NOT NULL,
      title text NOT NULL,
      details text,
      suggested_action text,
      status text DEFAULT 'open' NOT NULL,
      source text DEFAULT 'agent' NOT NULL,
      created_at timestamp with time zone DEFAULT now() NOT NULL,
      acknowledged_at timestamp with time zone,
      acknowledged_by text,
      resolved_at timestamp with time zone,
      resolved_by text,
      resolution_note text
    );
    CREATE INDEX IF NOT EXISTS alerts_status_idx ON alerts (status, created_at);

    -- notifications
    CREATE TABLE IF NOT EXISTS notifications (
      id serial PRIMARY KEY,
      type text NOT NULL,
      severity text DEFAULT 'info' NOT NULL,
      title text NOT NULL,
      body text,
      link text,
      read_by integer[] DEFAULT '{}'::integer[] NOT NULL,
      created_at timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notifications_created_idx ON notifications (created_at);

    -- pricing_versions
    CREATE TABLE IF NOT EXISTS pricing_versions (
      id serial PRIMARY KEY,
      bw_paise integer NOT NULL,
      color_paise integer NOT NULL,
      duplex_discount_pct integer DEFAULT 0 NOT NULL,
      min_txn_paise integer DEFAULT 0 NOT NULL,
      config jsonb NOT NULL,
      note text,
      active boolean DEFAULT false NOT NULL,
      published_by text,
      created_at timestamp with time zone DEFAULT now() NOT NULL
    );

    -- inventory_items
    CREATE TABLE IF NOT EXISTS inventory_items (
      id serial PRIMARY KEY,
      sku text NOT NULL UNIQUE,
      name text NOT NULL,
      category text NOT NULL,
      unit text NOT NULL,
      stock integer DEFAULT 0 NOT NULL,
      reorder_threshold integer DEFAULT 0 NOT NULL,
      unit_cost_paise integer DEFAULT 0 NOT NULL,
      created_at timestamp with time zone DEFAULT now() NOT NULL
    );

    -- inventory_movements
    CREATE TABLE IF NOT EXISTS inventory_movements (
      id serial PRIMARY KEY,
      item_id integer NOT NULL,
      kind text NOT NULL,
      qty integer NOT NULL,
      unit_cost_paise integer,
      supplier text,
      reference text,
      note text,
      by_name text,
      created_at timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS inv_mov_item_idx ON inventory_movements (item_id, created_at);
  `);

  console.log("Admin tables and constraints created successfully!");
  await client.end();
}

run().catch((e) => {
  console.error("Migration error:", e);
  process.exit(1);
});

