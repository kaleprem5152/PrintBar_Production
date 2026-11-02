import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const orderStatusEnum = pgEnum("order_status", [
  "created",           // Order row exists, payment not yet initiated
  "pending_payment",   // Cashfree order created, awaiting customer payment
  "payment_pending",   // Payment initiated but webhook not yet received
  "payment_failed",    // Payment failed or expired
  "paid",              // Cashfree webhook confirmed payment; PIN issued
  "pin_accepted",      // Customer entered PIN at kiosk
  "queued",            // Job waiting for Raspberry Pi agent to pick up
  "claimed",           // Raspberry Pi atomically claimed the job
  "processing",        // Pi is converting/preparing the document
  "printing",          // CUPS job submitted and active
  "fallback_pending",  // Primary printer failed; evaluating fallback
  "fallback_printing", // Printing resumed on fallback printer
  "completed",         // Print confirmed complete; document deleted
  "failed",            // Terminal failure (fallback also failed or not attempted)
  "cancelled",         // Cancelled before printing
  "refund_pending",    // Admin initiated refund
  "refunded",          // Refund processed
]);

export const colorModeEnum = pgEnum("color_mode", ["bw", "color"]);
export const sidesEnum = pgEnum("sides", ["single", "double"]);
export const orientationEnum = pgEnum("orientation", ["portrait", "landscape"]);
export const printerNameEnum = pgEnum("printer_name", ["kyocera_pa3500x", "canon_gx6170"]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "pending", "success", "failed", "refunded"
]);
export const auditEventTypeEnum = pgEnum("audit_event_type", [
  "order_created",
  "payment_initiated",
  "payment_success",
  "payment_failed",
  "pin_issued",
  "pin_verified",
  "print_started",
  "print_completed",
  "print_failed",
  "fallback_triggered",
  "document_deleted",
  "admin_login",
  "admin_action",
  "refund_initiated",
  "refund_completed",
  "device_heartbeat",
  "device_auth_failed",
]);

// ─── Type exports ─────────────────────────────────────────────────────────────

/** Stored inside orders.docs JSONB array */
export type OrderDoc = {
  id: string;        // UUID — matches temp file storage key
  name: string;      // Sanitised original filename
  size: number;      // Bytes
  pages: number;     // Total pages in file (server-counted)
  selected: number;  // Pages to print per copy
  range: string | null; // Custom page range string, null = all pages
  estimated: boolean;   // True when page count was estimated not extracted
  kind: string;         // "pdf" | "doc" | "docx" | "jpg" | "png"
};

// ─── orders ───────────────────────────────────────────────────────────────────

export const orders = pgTable(
  "orders",
  {
    id:            serial("id").primaryKey(),
    orderId:       text("order_id").notNull().unique(),
    token:         text("token").notNull(),           // Customer session secret
    status:        orderStatusEnum("status").notNull().default("created"),

    // ── Document config ──────────────────────────────────────────────────────
    docs:          jsonb("docs").$type<OrderDoc[]>().notNull(),
    pagesPerCopy:  integer("pages_per_copy").notNull(),
    copies:        integer("copies").notNull().default(1),
    colorMode:     colorModeEnum("color_mode").notNull(),
    paperSize:     text("paper_size").notNull().default("A4"),
    sides:         sidesEnum("sides").notNull().default("single"),
    orientation:   orientationEnum("orientation").notNull().default("portrait"),

    // ── Pricing (server-locked at order creation) ─────────────────────────────
    amount:        integer("amount").notNull(),        // Total in rupees
    rateApplied:   integer("rate_applied").notNull(),  // Per-page rate at time of order
    pagesToPrint:  integer("pages_to_print").notNull(),

    // ── Payment ───────────────────────────────────────────────────────────────
    cashfreeOrderId:   text("cashfree_order_id"),      // CF order ID for checkout
    cashfreePaymentId: text("cashfree_payment_id"),    // CF transaction reference
    paidAt:            timestamp("paid_at"),

    // ── PIN ───────────────────────────────────────────────────────────────────
    pin:           text("pin"),                        // Null after completion
    expiresAt:     timestamp("expires_at"),            // PIN expiry (24h from paidAt)

    // ── Print execution ───────────────────────────────────────────────────────
    deviceId:          text("device_id"),              // Which Pi claimed this job
    printerUsed:       printerNameEnum("printer_used"), // Primary printer
    fallbackPrinter:   printerNameEnum("fallback_printer"), // Fallback printer (if used)
    cupsJobId:         text("cups_job_id"),            // CUPS job identifier
    fallbackCupsJobId: text("fallback_cups_job_id"),
    printStartedAt:    timestamp("print_started_at"),
    printClaimedAt:    timestamp("print_claimed_at"),
    pagesPrinted:      integer("pages_printed").notNull().default(0),
    printBaseline:     integer("print_baseline").notNull().default(0), // Pages done before resume
    fallbackAt:        timestamp("fallback_at"),       // When fallback was triggered
    completedAt:       timestamp("completed_at"),
    failureReason:     text("failure_reason"),

    // ── Privacy ───────────────────────────────────────────────────────────────
    filesDeleted:     boolean("files_deleted").notNull().default(false),
    filesDeletedAt:   timestamp("files_deleted_at"),

    // ── Metadata ──────────────────────────────────────────────────────────────
    isDemo:        boolean("is_demo").notNull().default(false),
    createdAt:     timestamp("created_at").notNull().defaultNow(),
    updatedAt:     timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("orders_status_idx").on(t.status),
    index("orders_device_idx").on(t.deviceId),
    index("orders_cashfree_order_idx").on(t.cashfreeOrderId),
    index("orders_pin_idx").on(t.pin),
  ]
);

// ─── payment_transactions ─────────────────────────────────────────────────────

export const paymentTransactions = pgTable(
  "payment_transactions",
  {
    id:                  serial("id").primaryKey(),
    orderId:             text("order_id").notNull().references(() => orders.orderId),
    cashfreeOrderId:     text("cashfree_order_id").notNull(),
    cashfreePaymentId:   text("cashfree_payment_id"),
    status:              paymentStatusEnum("status").notNull().default("pending"),
    amount:              integer("amount").notNull(),            // Rupees
    currency:            text("currency").notNull().default("INR"),
    paymentMethod:       text("payment_method"),                // upi, card, netbanking, etc.
    webhookReceivedAt:   timestamp("webhook_received_at"),
    webhookPayload:      jsonb("webhook_payload"),              // Raw CF payload (no PII)
    processedAt:         timestamp("processed_at"),
    refundId:            text("refund_id"),                     // CF refund ID if refunded
    refundAmount:        integer("refund_amount"),
    refundedAt:          timestamp("refunded_at"),
    createdAt:           timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("payment_transactions_order_idx").on(t.orderId),
    uniqueIndex("payment_transactions_cf_payment_idx").on(t.cashfreePaymentId),
    index("payment_transactions_status_idx").on(t.status),
  ]
);

// ─── print_jobs ───────────────────────────────────────────────────────────────

export const printJobs = pgTable(
  "print_jobs",
  {
    id:           serial("id").primaryKey(),
    orderId:      text("order_id").notNull().references(() => orders.orderId),
    jobRef:       text("job_ref").notNull().unique(),           // Internal job reference
    deviceId:     text("device_id").notNull(),
    printerName:  printerNameEnum("printer_name").notNull(),
    cupsJobId:    text("cups_job_id"),
    isFallback:   boolean("is_fallback").notNull().default(false),
    pagesAttempted: integer("pages_attempted").notNull().default(0),
    pagesConfirmed: integer("pages_confirmed").notNull().default(0),
    startedAt:    timestamp("started_at").notNull().defaultNow(),
    completedAt:  timestamp("completed_at"),
    failedAt:     timestamp("failed_at"),
    failureReason: text("failure_reason"),
    cupsStatus:   text("cups_status"),                         // Last raw CUPS status
    retryCount:   integer("retry_count").notNull().default(0),
    notes:        text("notes"),
  },
  (t) => [
    index("print_jobs_order_idx").on(t.orderId),
    index("print_jobs_device_idx").on(t.deviceId),
  ]
);

// ─── printer_status_history ───────────────────────────────────────────────────

export const printerStatusHistory = pgTable(
  "printer_status_history",
  {
    id:          serial("id").primaryKey(),
    deviceId:    text("device_id").notNull(),
    printerName: printerNameEnum("printer_name").notNull(),
    status:      text("status").notNull(),                     // CUPS state string
    cupsJobId:   text("cups_job_id"),
    paperReady:  boolean("paper_ready"),                       // null if unknown
    tonerOk:     boolean("toner_ok"),                          // null if unknown
    rawPayload:  jsonb("raw_payload"),
    reportedAt:  timestamp("reported_at").notNull().defaultNow(),
  },
  (t) => [
    index("printer_status_device_idx").on(t.deviceId),
    index("printer_status_time_idx").on(t.reportedAt),
  ]
);

// ─── devices ──────────────────────────────────────────────────────────────────

/** One row per physical PrintBar machine (Raspberry Pi) */
export const devices = pgTable(
  "devices",
  {
    id:            text("id").primaryKey(),                    // e.g. "PB-K01"
    name:          text("name").notNull(),
    location:      text("location").notNull(),
    secretHash:    text("secret_hash").notNull(),              // bcrypt hash of DEVICE_AUTH_SECRET
    isActive:      boolean("is_active").notNull().default(true),
    lastHeartbeat: timestamp("last_heartbeat"),
    kyoceraReady:  boolean("kyocera_ready"),
    canonReady:    boolean("canon_ready"),
    maintenanceMode: boolean("maintenance_mode").notNull().default(false),
    createdAt:     timestamp("created_at").notNull().defaultNow(),
    updatedAt:     timestamp("updated_at").notNull().defaultNow(),
  }
);

// ─── admin_users ──────────────────────────────────────────────────────────────

export const adminUsers = pgTable(
  "admin_users",
  {
    id:           serial("id").primaryKey(),
    username:     text("username").notNull().unique(),
    passwordHash: text("password_hash").notNull(),             // bcrypt
    isActive:     boolean("is_active").notNull().default(true),
    lastLoginAt:  timestamp("last_login_at"),
    createdAt:    timestamp("created_at").notNull().defaultNow(),
  }
);

// ─── pricing_config ───────────────────────────────────────────────────────────

/** Allows pricing to be changed from the admin panel without a code deploy */
export const pricingConfig = pgTable(
  "pricing_config",
  {
    id:         serial("id").primaryKey(),
    bwPerPage:  integer("bw_per_page").notNull().default(2),   // Rupees
    colorPerPage: integer("color_per_page").notNull().default(8),
    currency:   text("currency").notNull().default("INR"),
    effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
    createdAt:  timestamp("created_at").notNull().defaultNow(),
    createdBy:  text("created_by"),                            // Admin username
  }
);

// ─── audit_events ─────────────────────────────────────────────────────────────

export const auditEvents = pgTable(
  "audit_events",
  {
    id:        serial("id").primaryKey(),
    eventType: auditEventTypeEnum("event_type").notNull(),
    orderId:   text("order_id"),
    deviceId:  text("device_id"),
    actorId:   text("actor_id"),                               // Admin username or device ID
    details:   jsonb("details"),                               // Non-sensitive context
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("audit_events_order_idx").on(t.orderId),
    index("audit_events_type_idx").on(t.eventType),
    index("audit_events_time_idx").on(t.createdAt),
  ]
);

// ─── Inferred types ───────────────────────────────────────────────────────────

export type OrderRow              = typeof orders.$inferSelect;
export type OrderInsert           = typeof orders.$inferInsert;
export type PaymentTransactionRow = typeof paymentTransactions.$inferSelect;
export type PrintJobRow           = typeof printJobs.$inferSelect;
export type DeviceRow             = typeof devices.$inferSelect;
export type AdminUserRow          = typeof adminUsers.$inferSelect;
export type AuditEventRow         = typeof auditEvents.$inferSelect;
export type PricingConfigRow      = typeof pricingConfig.$inferSelect;
