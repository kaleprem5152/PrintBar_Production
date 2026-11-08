import { sql } from "drizzle-orm";
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

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const created = () => tstz("created_at").defaultNow().notNull();

/* ════════════════════════════════════════════════════════════════════════════
   1. ADMIN CONTROL CENTRE FLEET & OPERATIONS SCHEMA
   ════════════════════════════════════════════════════════════════════════════ */

export type NotifyPrefs = {
  inApp?: boolean;
  push?: boolean;
  types?: Record<string, boolean>;
  minSeverity?: "info" | "warning" | "critical";
};

export const adminUsers = pgTable("admin_users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").notNull(), // super_admin | ops_admin | finance_admin | maintenance
  passwordHash: text("password_hash").notNull(),
  active: boolean("active").notNull().default(true),
  mustChangePassword: boolean("must_change_password").notNull().default(true),
  notifyPrefs: jsonb("notify_prefs").$type<NotifyPrefs>().notNull().default(sql`'{}'::jsonb`),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: tstz("locked_until"),
  lastLoginAt: tstz("last_login_at"),
  createdAt: created(),
});

export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: text("id").primaryKey(), // sha256 of the cookie token
    userId: integer("user_id").notNull(),
    createdAt: created(),
    lastSeenAt: tstz("last_seen_at").defaultNow().notNull(),
    expiresAt: tstz("expires_at").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    revokedAt: tstz("revoked_at"),
  },
  (t) => [index("admin_sessions_user_idx").on(t.userId)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id"),
    userName: text("user_name"),
    role: text("role"),
    action: text("action").notNull(),
    entity: text("entity"),
    entityId: text("entity_id"),
    details: jsonb("details").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
    ip: text("ip"),
    createdAt: created(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt), index("audit_action_idx").on(t.action)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: tstz("updated_at").defaultNow().notNull(),
  updatedByName: text("updated_by_name"),
});

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: created(),
});

export const kiosks = pgTable("kiosks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  maintenance: boolean("maintenance").notNull().default(false),
  printingPaused: boolean("printing_paused").notNull().default(false),
  lastHeartbeat: tstz("last_heartbeat"),
  softwareVersion: text("software_version"),
  networkType: text("network_type"),
  ipAddress: text("ip_address"),
  backendConnected: boolean("backend_connected").notNull().default(false),
  piTempC: integer("pi_temp_c"),
  piCpuPct: integer("pi_cpu_pct"),
  piMemPct: integer("pi_mem_pct"),
  diskPct: integer("disk_pct"),
  upsStatus: text("ups_status"), // null = not supported / not reported
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: created(),
});

export const printers = pgTable(
  "printers",
  {
    id: text("id").primaryKey(),
    kioskId: text("kiosk_id").notNull(),
    name: text("name").notNull(),
    model: text("model").notNull(),
    ip: text("ip"),
    cupsQueue: text("cups_queue"),
    role: text("role").notNull().default("primary"), // primary | backup
    priority: integer("priority").notNull().default(1),
    enabled: boolean("enabled").notNull().default(true),
    paused: boolean("paused").notNull().default(false),
    autoFailover: boolean("auto_failover").notNull().default(true),
    supportsColor: boolean("supports_color").notNull().default(false),
    connected: boolean("connected").notNull().default(false),
    state: text("state").notNull().default("offline"), // idle | printing | error | offline
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    paperCapacity: integer("paper_capacity").notNull().default(250),
    paperRemaining: integer("paper_remaining"),
    paperSource: text("paper_source").notNull().default("estimated"), // telemetry | estimated | manual
    tonerBlack: integer("toner_black"),
    tonerColor: integer("toner_color"),
    tonerSource: text("toner_source").notNull().default("unsupported"),
    drumLife: integer("drum_life"),
    drumSource: text("drum_source").notNull().default("unsupported"),
    totalPages: integer("total_pages").notNull().default(0),
    lastSuccessfulPrintAt: tstz("last_successful_print_at"),
    lastHeartbeat: tstz("last_heartbeat"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: created(),
  },
  (t) => [index("printers_kiosk_idx").on(t.kioskId)],
);

export const printerEvents = pgTable(
  "printer_events",
  {
    id: serial("id").primaryKey(),
    printerId: text("printer_id").notNull(),
    kind: text("kind").notNull(), // error | info | config
    code: text("code"),
    message: text("message").notNull(),
    createdAt: created(),
  },
  (t) => [index("printer_events_printer_idx").on(t.printerId, t.createdAt)],
);

export const maintenanceRecords = pgTable(
  "maintenance_records",
  {
    id: serial("id").primaryKey(),
    printerId: text("printer_id").notNull(),
    type: text("type").notNull(), // paper_refill | toner_replace | drum_replace | cleaning | repair | inspection
    note: text("note"),
    costPaise: integer("cost_paise").notNull().default(0),
    performedBy: text("performed_by"),
    createdAt: created(),
  },
  (t) => [index("maint_printer_idx").on(t.printerId)],
);

export const connectivityEvents = pgTable(
  "connectivity_events",
  {
    id: serial("id").primaryKey(),
    kioskId: text("kiosk_id").notNull(),
    kind: text("kind").notNull(), // online | offline
    detail: text("detail"),
    createdAt: created(),
  },
  (t) => [index("conn_kiosk_idx").on(t.kioskId, t.createdAt)],
);

export const kioskLogs = pgTable(
  "kiosk_logs",
  {
    id: serial("id").primaryKey(),
    kioskId: text("kiosk_id").notNull(),
    level: text("level").notNull().default("info"),
    source: text("source").notNull().default("agent"),
    message: text("message").notNull(),
    createdAt: created(),
  },
  (t) => [index("kiosk_logs_idx").on(t.kioskId, t.createdAt)],
);

export const deviceCommands = pgTable(
  "device_commands",
  {
    id: serial("id").primaryKey(),
    kioskId: text("kiosk_id").notNull(),
    printerId: text("printer_id"),
    command: text("command").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("queued"), // queued | delivered | succeeded | failed | cancelled
    result: text("result"),
    requestedBy: text("requested_by"),
    createdAt: created(),
    deliveredAt: tstz("delivered_at"),
    completedAt: tstz("completed_at"),
  },
  (t) => [uniqueIndex("device_commands_idem").on(t.idempotencyKey), index("device_commands_kiosk_idx").on(t.kioskId, t.status)],
);

export const printJobs = pgTable(
  "print_jobs",
  {
    id: text("id").primaryKey(),
    customerRef: text("customer_ref").notNull(),
    fileName: text("file_name").notNull(),
    pages: integer("pages").notNull(),
    colorMode: text("color_mode").notNull(), // bw | color
    sided: text("sided").notNull(), // single | double
    pagesPerSheet: integer("pages_per_sheet").notNull().default(1),
    copies: integer("copies").notNull().default(1),
    amountPaise: integer("amount_paise").notNull(),
    paymentStatus: text("payment_status").notNull().default("pending"),
    status: text("status").notNull(),
    kioskId: text("kiosk_id"),
    printerId: text("printer_id"),
    pagesPrinted: integer("pages_printed").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    retryCount: integer("retry_count").notNull().default(0),
    documentDeletedAt: tstz("document_deleted_at"),
    createdAt: created(),
    updatedAt: tstz("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("jobs_created_idx").on(t.createdAt),
    index("jobs_status_idx").on(t.status),
    index("jobs_customer_idx").on(t.customerRef),
  ],
);

export const printAttempts = pgTable(
  "print_attempts",
  {
    id: serial("id").primaryKey(),
    jobId: text("job_id").notNull(),
    attemptNo: integer("attempt_no").notNull(),
    printerId: text("printer_id"),
    status: text("status").notNull(), // queued | printing | succeeded | failed | partial | cancelled
    pagesPrinted: integer("pages_printed").notNull().default(0),
    cupsJobId: text("cups_job_id"),
    error: text("error"),
    startedAt: tstz("started_at").defaultNow().notNull(),
    endedAt: tstz("ended_at"),
  },
  (t) => [
    uniqueIndex("attempts_job_no").on(t.jobId, t.attemptNo),
    uniqueIndex("attempts_one_live").on(t.jobId).where(sql`${t.status} in ('queued','printing')`),
  ],
);

export const jobLogs = pgTable(
  "job_logs",
  {
    id: serial("id").primaryKey(),
    jobId: text("job_id").notNull(),
    level: text("level").notNull().default("info"),
    message: text("message").notNull(),
    createdAt: created(),
  },
  (t) => [index("job_logs_idx").on(t.jobId, t.createdAt)],
);

export const payments = pgTable(
  "payments",
  {
    id: serial("id").primaryKey(),
    jobId: text("job_id").notNull(),
    orderId: text("order_id").notNull().unique(),
    transactionId: text("transaction_id"),
    amountPaise: integer("amount_paise").notNull(),
    feePaise: integer("fee_paise").notNull().default(0),
    method: text("method"),
    status: text("status").notNull().default("pending"), // pending | success | failed
    refundedPaise: integer("refunded_paise").notNull().default(0),
    customerStatus: text("customer_status"),
    failureReason: text("failure_reason"),
    createdAt: created(),
    paidAt: tstz("paid_at"),
    reconciledAt: tstz("reconciled_at"),
  },
  (t) => [index("payments_job_idx").on(t.jobId), index("payments_created_idx").on(t.createdAt)],
);

export const refunds = pgTable(
  "refunds",
  {
    id: serial("id").primaryKey(),
    refundRef: text("refund_ref").notNull().unique(),
    paymentId: integer("payment_id").notNull(),
    jobId: text("job_id").notNull(),
    amountPaise: integer("amount_paise").notNull(),
    type: text("type").notNull(), // full | partial
    reason: text("reason").notNull(),
    status: text("status").notNull().default("requested"), // requested | processing | success | failed
    gatewayRefundId: text("gateway_refund_id"),
    gatewayStatus: text("gateway_status"),
    gatewayMessage: text("gateway_message"),
    initiatedBy: text("initiated_by"),
    createdAt: created(),
    updatedAt: tstz("updated_at").defaultNow().notNull(),
    completedAt: tstz("completed_at"),
  },
  (t) => [
    index("refunds_payment_idx").on(t.paymentId),
    uniqueIndex("refunds_one_active").on(t.paymentId).where(sql`${t.status} in ('requested','processing')`),
  ],
);

export const alerts = pgTable(
  "alerts",
  {
    id: serial("id").primaryKey(),
    kioskId: text("kiosk_id"),
    printerId: text("printer_id"),
    type: text("type").notNull(),
    severity: text("severity").notNull(), // critical | warning | info
    title: text("title").notNull(),
    details: text("details"),
    suggestedAction: text("suggested_action"),
    status: text("status").notNull().default("open"), // open | acknowledged | resolved
    source: text("source").notNull().default("agent"),
    createdAt: created(),
    acknowledgedAt: tstz("acknowledged_at"),
    acknowledgedBy: text("acknowledged_by"),
    resolvedAt: tstz("resolved_at"),
    resolvedBy: text("resolved_by"),
    resolutionNote: text("resolution_note"),
  },
  (t) => [index("alerts_status_idx").on(t.status, t.createdAt)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    type: text("type").notNull(),
    severity: text("severity").notNull().default("info"),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    readBy: integer("read_by").array().notNull().default(sql`'{}'::integer[]`),
    createdAt: created(),
  },
  (t) => [index("notifications_created_idx").on(t.createdAt)],
);

export const pricingVersions = pgTable("pricing_versions", {
  id: serial("id").primaryKey(),
  bwPaise: integer("bw_paise").notNull(),
  colorPaise: integer("color_paise").notNull(),
  duplexDiscountPct: integer("duplex_discount_pct").notNull().default(0),
  minTxnPaise: integer("min_txn_paise").notNull().default(0),
  config: jsonb("config")
    .$type<{
      pagesPerSheet: number[];
      maxCopies: number;
      maxPages: number;
      singleSided: boolean;
      doubleSided: boolean;
    }>()
    .notNull(),
  note: text("note"),
  active: boolean("active").notNull().default(false),
  publishedBy: text("published_by"),
  createdAt: created(),
});

export const inventoryItems = pgTable("inventory_items", {
  id: serial("id").primaryKey(),
  sku: text("sku").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull(), // paper | toner | ink | drum | parts
  unit: text("unit").notNull(),
  stock: integer("stock").notNull().default(0),
  reorderThreshold: integer("reorder_threshold").notNull().default(0),
  unitCostPaise: integer("unit_cost_paise").notNull().default(0),
  createdAt: created(),
});

export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id").notNull(),
    kind: text("kind").notNull(), // purchase | consumption | adjustment
    qty: integer("qty").notNull(), // signed
    unitCostPaise: integer("unit_cost_paise"),
    supplier: text("supplier"),
    reference: text("reference"),
    note: text("note"),
    byName: text("by_name"),
    createdAt: created(),
  },
  (t) => [index("inv_mov_item_idx").on(t.itemId, t.createdAt)],
);

/* ════════════════════════════════════════════════════════════════════════════
   2. CUSTOMER & HARDWARE DEVICE INTEGRATION SCHEMA
   ════════════════════════════════════════════════════════════════════════════ */

export const orderStatusEnum = pgEnum("order_status", [
  "created",
  "pending_payment",
  "payment_pending",
  "payment_failed",
  "paid",
  "pin_accepted",
  "queued",
  "claimed",
  "processing",
  "printing",
  "fallback_pending",
  "fallback_printing",
  "completed",
  "failed",
  "cancelled",
  "refund_pending",
  "refunded",
  "requires_manual_review",
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
  "pin_rejected",
  "print_started",
  "print_progress",
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
  "cleanup_failed",
  "refund_failed",
  "reconciliation_matched",
]);

/** Stored inside orders.docs JSONB array */
export type OrderDoc = {
  id: string;
  name: string;
  size: number;
  pages: number;
  selected: number;
  range: string | null;
  estimated: boolean;
  kind: string;
};

export const orders = pgTable(
  "orders",
  {
    id:             serial("id").primaryKey(),
    orderId:        text("order_id").notNull().unique(),
    token:          text("token").notNull(),
    pin:            text("pin"),
    status:         orderStatusEnum("status").notNull().default("created"),
    docs:           jsonb("docs").$type<OrderDoc[]>().notNull(),
    pagesPerCopy:   integer("pages_per_copy").notNull(),
    copies:         integer("copies").notNull().default(1),
    colorMode:      colorModeEnum("color_mode").notNull(),
    paperSize:      text("paper_size").notNull().default("A4"),
    sides:          sidesEnum("sides").notNull().default("single"),
    orientation:    orientationEnum("orientation").notNull().default("portrait"),
    pagesPerSheet:  integer("pages_per_sheet").notNull().default(1),
    physicalSheets: integer("physical_sheets").notNull().default(1),
    billingBasis:   text("billing_basis").notNull().default("sheet"),
    amount:         integer("amount").notNull(),
    amountPaise:    integer("amount_paise").notNull().default(0),
    rateApplied:    integer("rate_applied").notNull(),
    pagesToPrint:   integer("pages_to_print").notNull(),
    pagesPrinted:   integer("pages_printed").notNull().default(0),
    sheetsPrinted:  integer("sheets_printed").default(0),
    sheetsAttempted: integer("sheets_attempted").default(0),
    sheetsConfirmed: integer("sheets_confirmed").default(0),
    printBaseline:  integer("print_baseline").notNull().default(0),
    deviceId:       text("device_id"),
    printerUsed:    text("printer_used"),
    fallbackPrinter: text("fallback_printer"),
    cupsJobId:      text("cups_job_id"),
    fallbackCupsJobId: text("fallback_cups_job_id"),
    failureReason:  text("failure_reason"),
    pricingSnapshot: jsonb("pricing_snapshot"),
    cashfreeOrderId:   text("cashfree_order_id"),
    cashfreePaymentId: text("cashfree_payment_id"),
    cashfreeSessionId: text("cashfree_session_id"),
    paymentMethod:     text("payment_method"),
    paidAmountPaise:   integer("paid_amount_paise"),
    refundStatus:      text("refund_status").notNull().default("NOT_REQUIRED"),
    refundableAmount:  integer("refundable_amount").notNull().default(0),
    refundedAmount:    integer("refunded_amount").notNull().default(0),
    cashfreeRefundId:  text("cashfree_refund_id"),
    isDemo:            boolean("is_demo").notNull().default(false),
    cleanupStatus:     text("cleanup_status").notNull().default("PENDING"),
    cleanupAttempts:   integer("cleanup_attempts").notNull().default(0),
    cleanupError:      text("cleanup_error"),
    lastReconciledAt:  timestamp("last_reconciled_at"),
    reconciliationNotes: text("reconciliation_notes"),
    createdAt:         timestamp("created_at").notNull().defaultNow(),
    updatedAt:         timestamp("updated_at").notNull().defaultNow(),
    paidAt:            timestamp("paid_at"),
    pinHash:           text("pin_hash"),
    pinAttempts:       integer("pin_attempts").notNull().default(0),
    pinLockedUntil:    timestamp("pin_locked_until"),
    printStartedAt:    timestamp("print_started_at"),
    printClaimedAt:    timestamp("print_claimed_at"),
    filesDeleted:      boolean("files_deleted").notNull().default(false),
    filesDeletedAt:    timestamp("files_deleted_at"),
    fallbackAt:        timestamp("fallback_at"),
    completedAt:       timestamp("completed_at"),
    expiresAt:         timestamp("expires_at").notNull().default(sql`NOW() + INTERVAL '24 hours'`),
    deletedAt:         timestamp("deleted_at"),
  },
  (t) => [
    index("orders_pin_idx").on(t.pin),
    index("orders_status_idx").on(t.status),
    index("orders_cf_order_idx").on(t.cashfreeOrderId),
    index("orders_device_idx").on(t.deviceId),
    index("orders_expires_idx").on(t.expiresAt),
  ]
);

export const paymentTransactions = pgTable(
  "payment_transactions",
  {
    id:                serial("id").primaryKey(),
    orderId:           text("order_id").notNull().references(() => orders.orderId),
    cashfreeOrderId:   text("cashfree_order_id").notNull(),
    cashfreePaymentId: text("cashfree_payment_id"),
    amount:            integer("amount").notNull(),
    amountPaise:       integer("amount_paise").notNull().default(0),
    currency:          text("currency").notNull().default("INR"),
    status:            paymentStatusEnum("status").notNull().default("pending"),
    paymentMethod:     text("payment_method"),
    gatewayResponse:   jsonb("gateway_response"),
    signatureVerified: boolean("signature_verified").notNull().default(false),
    webhookReceivedAt: timestamp("webhook_received_at"),
    webhookPayload:    jsonb("webhook_payload"),
    processedAt:       timestamp("processed_at"),
    createdAt:         timestamp("created_at").notNull().defaultNow(),
    updatedAt:         timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("pt_order_idx").on(t.orderId),
    index("pt_cf_order_idx").on(t.cashfreeOrderId),
  ]
);

export const refundTransactions = pgTable(
  "refund_transactions",
  {
    id:                   serial("id").primaryKey(),
    orderId:              text("order_id").notNull(),
    paymentTransactionId: integer("payment_transaction_id"),
    cashfreePaymentId:    text("cashfree_payment_id").notNull(),
    cashfreeRefundId:     text("cashfree_refund_id").notNull().unique(),
    requestedAmount:      integer("requested_amount").notNull(),
    completedAmount:      integer("completed_amount"),
    currency:             text("currency").notNull().default("INR"),
    reason:               text("reason").notNull(),
    status:               text("status").notNull().default("REFUND_REQUESTED"),
    initiatedBy:          text("initiated_by").notNull().default("system"),
    idempotencyKey:       text("idempotency_key").notNull().unique(),
    failureReason:        text("failure_reason"),
    cfResponse:           jsonb("cf_response"),
    createdAt:            timestamp("created_at").notNull().defaultNow(),
    updatedAt:            timestamp("updated_at").notNull().defaultNow(),
    completedAt:          timestamp("completed_at"),
  },
  (t) => [
    index("rt_order_idx").on(t.orderId),
    index("rt_cf_refund_idx").on(t.cashfreeRefundId),
    index("rt_status_idx").on(t.status),
  ]
);

export const devicePrintJobs = pgTable(
  "device_print_jobs",
  {
    id:           serial("id").primaryKey(),
    orderId:      text("order_id").notNull(),
    jobRef:       text("job_ref").notNull(),
    deviceId:     text("device_id").notNull(),
    printerName:  text("printer_name").notNull(),
    cupsJobId:    text("cups_job_id"),
    isFallback:   boolean("is_fallback").notNull().default(false),
    pagesAttempted: integer("pages_attempted").notNull().default(0),
    pagesConfirmed: integer("pages_confirmed").notNull().default(0),
    sheetsAttempted: integer("sheets_attempted").notNull().default(0),
    sheetsConfirmed: integer("sheets_confirmed").notNull().default(0),
    startedAt:    timestamp("started_at").notNull().defaultNow(),
    completedAt:  timestamp("completed_at"),
    failedAt:     timestamp("failed_at"),
    failureReason: text("failure_reason"),
    cupsStatus:   text("cups_status"),
    retryCount:   integer("retry_count").notNull().default(0),
    notes:        text("notes"),
  },
  (t) => [
    index("dpj_order_idx").on(t.orderId),
    index("dpj_device_idx").on(t.deviceId),
  ]
);

export const printerStatusHistory = pgTable(
  "printer_status_history",
  {
    id:           serial("id").primaryKey(),
    deviceId:     text("device_id").notNull(),
    printerName:  text("printer_name").notNull(),
    status:       text("status").notNull(),
    paperReady:   boolean("paper_ready").notNull().default(true),
    tonerOk:      boolean("toner_ok").notNull().default(true),
    errorMessage: text("error_message"),
    rawPayload:   jsonb("raw_payload"),
    recordedAt:   timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => [
    index("psh_device_idx").on(t.deviceId),
    index("psh_recorded_idx").on(t.recordedAt),
  ]
);

export const devices = pgTable(
  "devices",
  {
    id:              text("id").primaryKey(),
    name:            text("name").notNull(),
    location:        text("location").notNull(),
    secretHash:      text("secret_hash").notNull(),
    isActive:        boolean("is_active").notNull().default(true),
    lastHeartbeat:   timestamp("last_heartbeat"),
    kyoceraReady:    boolean("kyocera_ready").default(true),
    canonReady:      boolean("canon_ready").default(true),
    kyoceraPaper:    integer("kyocera_paper").notNull().default(250),
    canonPaper:      integer("canon_paper").notNull().default(250),
    paperReady:      boolean("paper_ready").notNull().default(true),
    maintenanceMode: boolean("maintenance_mode").notNull().default(false),
    createdAt:       timestamp("created_at").notNull().defaultNow(),
    updatedAt:       timestamp("updated_at").notNull().defaultNow(),
  }
);

export const pricingConfig = pgTable(
  "pricing_config",
  {
    id:           serial("id").primaryKey(),
    bwPerPage:    integer("bw_per_page").notNull().default(2),
    colorPerPage: integer("color_per_page").notNull().default(8),
    currency:     text("currency").notNull().default("INR"),
    billingBasis: text("billing_basis").notNull().default("per_sheet"),
    minOrderAmount: integer("min_order_amount").notNull().default(2),
    duplexDiscountPaise: integer("duplex_discount_paise").notNull().default(0),
    nupRules:     jsonb("nup_rules"),
    updatedBy:    text("updated_by").notNull().default("system"),
    createdAt:    timestamp("created_at").notNull().defaultNow(),
  }
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id:          serial("id").primaryKey(),
    eventType:   auditEventTypeEnum("event_type").notNull(),
    orderId:     text("order_id"),
    deviceId:    text("device_id"),
    adminUserId: text("admin_user_id"),
    actorId:     text("actor_id"),
    details:     jsonb("details"),
    ipAddress:   text("ip_address"),
    createdAt:   timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("ae_order_idx").on(t.orderId),
    index("ae_event_idx").on(t.eventType),
    index("ae_created_idx").on(t.createdAt),
  ]
);

/* Type helpers */
export type OrderRow               = typeof orders.$inferSelect;
export type OrderInsert            = typeof orders.$inferInsert;
export type DeviceRow              = typeof devices.$inferSelect;
export type DeviceInsert           = typeof devices.$inferInsert;
export type RefundTransactionRow   = typeof refundTransactions.$inferSelect;
export type PaymentTransactionRow  = typeof paymentTransactions.$inferSelect;
export type PrinterStatusHistoryRow= typeof printerStatusHistory.$inferSelect;
export type PricingConfigRow       = typeof pricingConfig.$inferSelect;
export type AuditEventRow          = typeof auditEvents.$inferSelect;
export type DevicePrintJobRow      = typeof devicePrintJobs.$inferSelect;
