require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function syncOrdersToAdmin() {
  console.log("=== SYNCING REAL CUSTOMER ORDERS TO ADMIN PRINT_JOBS & PAYMENTS ===");

  // Check columns of payments table
  const colRes = await pool.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'payments'"
  );
  console.log("Payments table columns:", colRes.rows.map(r => r.column_name).join(", "));

  const { rows: realOrders } = await pool.query(`
    SELECT * FROM orders WHERE is_demo = false OR order_id LIKE 'PB-%' ORDER BY id ASC
  `);

  console.log(`Found ${realOrders.length} real customer orders.`);

  for (const o of realOrders) {
    const docs = typeof o.docs === 'string' ? JSON.parse(o.docs) : (o.docs || []);
    const fileName = docs[0]?.name || "Document.pdf";
    const amountPaise = o.amount_paise > 0 ? o.amount_paise : (o.amount * 100);

    // Map order status to print_job status
    let pjStatus = "created";
    if (o.status === "completed") pjStatus = "completed";
    else if (o.status === "failed") pjStatus = "failed";
    else if (o.status === "cancelled") pjStatus = "cancelled";
    else if (o.status === "printing" || o.status === "fallback_printing") pjStatus = "printing";
    else if (o.status === "claimed" || o.status === "processing") pjStatus = "claimed";
    else if (o.status === "paid" || o.status === "pin_accepted" || o.status === "queued") pjStatus = "queued";
    else if (o.status === "payment_failed") pjStatus = "failed";

    let payStatus = "pending";
    if (["paid", "pin_accepted", "queued", "claimed", "processing", "printing", "completed"].includes(o.status)) {
      payStatus = "success";
    } else if (o.status === "payment_failed") {
      payStatus = "failed";
    } else if (o.status === "refunded") {
      payStatus = "refunded";
    }

    const printerId = o.printer_used || (o.color_mode === 'color' ? 'canon_gx6170' : 'kyocera_pa3500x');

    await pool.query(`
      INSERT INTO print_jobs (
        id, customer_ref, file_name, pages, color_mode, sided,
        pages_per_sheet, copies, amount_paise, payment_status,
        status, kiosk_id, printer_id, pages_printed, error_code,
        error_message, retry_count, document_deleted_at, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, 'PB-K01', $12, $13, $14, $15, 0, $16, $17, $18
      )
      ON CONFLICT (id) DO UPDATE SET
        payment_status = $10,
        status = $11,
        kiosk_id = 'PB-K01',
        printer_id = $12,
        pages_printed = $13,
        document_deleted_at = $16,
        updated_at = $18
    `, [
      o.order_id,
      o.token || o.order_id,
      fileName,
      o.pages_to_print || 1,
      o.color_mode || 'bw',
      o.sides || 'single',
      o.pages_per_sheet || 1,
      o.copies || 1,
      amountPaise,
      payStatus,
      pjStatus,
      printerId,
      o.pages_printed || 0,
      o.failure_reason || null,
      o.failure_reason || null,
      o.files_deleted_at || null,
      o.created_at || new Date(),
      o.updated_at || new Date(),
    ]);

    // Upsert payment record
    const cfOrderId = o.cashfree_order_id || o.order_id;
    await pool.query(`
      INSERT INTO payments (
        job_id, order_id, transaction_id, amount_paise, fee_paise, method,
        status, refunded_paise, failure_reason, created_at, paid_at
      ) VALUES (
        $1, $2, $3, $4, 0, 'upi',
        $5, 0, $6, $7, $8
      )
      ON CONFLICT (order_id) DO UPDATE SET
        transaction_id = EXCLUDED.transaction_id,
        amount_paise = EXCLUDED.amount_paise,
        status = EXCLUDED.status,
        paid_at = EXCLUDED.paid_at
    `, [
      o.order_id,
      cfOrderId,
      o.cashfree_payment_id || null,
      amountPaise,
      payStatus,
      o.failure_reason || null,
      o.created_at || new Date(),
      payStatus === "success" ? (o.paid_at || o.created_at || new Date()) : null,
    ]);
  }

  console.log("Successfully synced real customer orders to print_jobs and payments!");
  await pool.end();
}

syncOrdersToAdmin().catch((err) => {
  console.error("Sync error:", err);
  process.exit(1);
});
