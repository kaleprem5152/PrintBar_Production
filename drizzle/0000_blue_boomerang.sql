CREATE TYPE "public"."audit_event_type" AS ENUM('order_created', 'payment_initiated', 'payment_success', 'payment_failed', 'pin_issued', 'pin_verified', 'print_started', 'print_completed', 'print_failed', 'fallback_triggered', 'document_deleted', 'admin_login', 'admin_action', 'refund_initiated', 'refund_completed', 'device_heartbeat', 'device_auth_failed');--> statement-breakpoint
CREATE TYPE "public"."color_mode" AS ENUM('bw', 'color');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('created', 'pending_payment', 'payment_pending', 'payment_failed', 'paid', 'pin_accepted', 'queued', 'claimed', 'processing', 'printing', 'fallback_pending', 'fallback_printing', 'completed', 'failed', 'cancelled', 'refund_pending', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."orientation" AS ENUM('portrait', 'landscape');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'success', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."printer_name" AS ENUM('kyocera_pa3500x', 'canon_gx6170');--> statement-breakpoint
CREATE TYPE "public"."sides" AS ENUM('single', 'double');--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_type" "audit_event_type" NOT NULL,
	"order_id" text,
	"device_id" text,
	"actor_id" text,
	"details" jsonb,
	"ip_address" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"location" text NOT NULL,
	"secret_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_heartbeat" timestamp,
	"kyocera_ready" boolean,
	"canon_ready" boolean,
	"maintenance_mode" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"token" text NOT NULL,
	"status" "order_status" DEFAULT 'created' NOT NULL,
	"docs" jsonb NOT NULL,
	"pages_per_copy" integer NOT NULL,
	"copies" integer DEFAULT 1 NOT NULL,
	"color_mode" "color_mode" NOT NULL,
	"paper_size" text DEFAULT 'A4' NOT NULL,
	"sides" "sides" DEFAULT 'single' NOT NULL,
	"orientation" "orientation" DEFAULT 'portrait' NOT NULL,
	"amount" integer NOT NULL,
	"rate_applied" integer NOT NULL,
	"pages_to_print" integer NOT NULL,
	"cashfree_order_id" text,
	"cashfree_payment_id" text,
	"paid_at" timestamp,
	"pin" text,
	"expires_at" timestamp,
	"device_id" text,
	"printer_used" "printer_name",
	"fallback_printer" "printer_name",
	"cups_job_id" text,
	"fallback_cups_job_id" text,
	"print_started_at" timestamp,
	"print_claimed_at" timestamp,
	"pages_printed" integer DEFAULT 0 NOT NULL,
	"print_baseline" integer DEFAULT 0 NOT NULL,
	"fallback_at" timestamp,
	"completed_at" timestamp,
	"failure_reason" text,
	"files_deleted" boolean DEFAULT false NOT NULL,
	"files_deleted_at" timestamp,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "payment_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"cashfree_order_id" text NOT NULL,
	"cashfree_payment_id" text,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"payment_method" text,
	"webhook_received_at" timestamp,
	"webhook_payload" jsonb,
	"processed_at" timestamp,
	"refund_id" text,
	"refund_amount" integer,
	"refunded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"bw_per_page" integer DEFAULT 2 NOT NULL,
	"color_per_page" integer DEFAULT 8 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "print_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"job_ref" text NOT NULL,
	"device_id" text NOT NULL,
	"printer_name" "printer_name" NOT NULL,
	"cups_job_id" text,
	"is_fallback" boolean DEFAULT false NOT NULL,
	"pages_attempted" integer DEFAULT 0 NOT NULL,
	"pages_confirmed" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"failed_at" timestamp,
	"failure_reason" text,
	"cups_status" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"notes" text,
	CONSTRAINT "print_jobs_job_ref_unique" UNIQUE("job_ref")
);
--> statement-breakpoint
CREATE TABLE "printer_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"printer_name" "printer_name" NOT NULL,
	"status" text NOT NULL,
	"cups_job_id" text,
	"paper_ready" boolean,
	"toner_ok" boolean,
	"raw_payload" jsonb,
	"reported_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_order_id_orders_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_order_id_orders_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_order_idx" ON "audit_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "audit_events_type_idx" ON "audit_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "audit_events_time_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_device_idx" ON "orders" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "orders_cashfree_order_idx" ON "orders" USING btree ("cashfree_order_id");--> statement-breakpoint
CREATE INDEX "orders_pin_idx" ON "orders" USING btree ("pin");--> statement-breakpoint
CREATE INDEX "payment_transactions_order_idx" ON "payment_transactions" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_transactions_cf_payment_idx" ON "payment_transactions" USING btree ("cashfree_payment_id");--> statement-breakpoint
CREATE INDEX "payment_transactions_status_idx" ON "payment_transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "print_jobs_order_idx" ON "print_jobs" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "print_jobs_device_idx" ON "print_jobs" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "printer_status_device_idx" ON "printer_status_history" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "printer_status_time_idx" ON "printer_status_history" USING btree ("reported_at");