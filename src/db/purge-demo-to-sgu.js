require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function purgeAndResetToSGU() {
  console.log("=== 1. PURGING FICTIONAL DEMO DATA ===");
  
  // Remove demo seed flag
  await pool.query("DELETE FROM settings WHERE key IN ('demo_seeded', 'demo_mode')");

  // Remove fictional demo kiosks and printers
  const fakeKiosks = ['KSK-001', 'KSK-002', 'KSK-003'];
  const fakePrinters = ['PRN-001', 'PRN-002', 'PRN-003', 'PRN-004', 'PRN-005'];

  // Delete dependencies first
  await pool.query("DELETE FROM printer_events WHERE printer_id = ANY($1)", [fakePrinters]);
  await pool.query("DELETE FROM maintenance_records WHERE printer_id = ANY($1)", [fakePrinters]);
  await pool.query("DELETE FROM print_attempts WHERE printer_id = ANY($1)", [fakePrinters]);
  await pool.query("DELETE FROM device_commands WHERE kiosk_id = ANY($1) OR printer_id = ANY($2)", [fakeKiosks, fakePrinters]);
  await pool.query("DELETE FROM alerts WHERE kiosk_id = ANY($1) OR printer_id = ANY($2)", [fakeKiosks, fakePrinters]);
  await pool.query("DELETE FROM notifications");
  await pool.query("DELETE FROM connectivity_events WHERE kiosk_id = ANY($1)", [fakeKiosks]);
  await pool.query("DELETE FROM kiosk_logs WHERE kiosk_id = ANY($1)", [fakeKiosks]);
  
  // Delete mock demo print jobs
  await pool.query("DELETE FROM job_logs WHERE job_id IN (SELECT id FROM print_jobs WHERE id LIKE 'PJ-%' OR id LIKE 'demo%' OR kiosk_id = ANY($1))", [fakeKiosks]);
  await pool.query("DELETE FROM print_attempts WHERE job_id IN (SELECT id FROM print_jobs WHERE id LIKE 'PJ-%' OR id LIKE 'demo%' OR kiosk_id = ANY($1))", [fakeKiosks]);
  await pool.query("DELETE FROM payments WHERE job_id IN (SELECT id FROM print_jobs WHERE id LIKE 'PJ-%' OR id LIKE 'demo%' OR kiosk_id = ANY($1))", [fakeKiosks]);
  await pool.query("DELETE FROM refunds WHERE job_id IN (SELECT id FROM print_jobs WHERE id LIKE 'PJ-%' OR id LIKE 'demo%' OR kiosk_id = ANY($1))", [fakeKiosks]);
  await pool.query("DELETE FROM print_jobs WHERE id LIKE 'PJ-%' OR id LIKE 'demo%' OR kiosk_id = ANY($1)", [fakeKiosks]);

  // Delete fake demo inventory movements
  await pool.query("DELETE FROM inventory_movements WHERE note LIKE '%demo%' OR by_name = 'System'");

  // Delete fake printers and fake kiosks
  await pool.query("DELETE FROM printers WHERE id = ANY($1) OR kiosk_id = ANY($2)", [fakePrinters, fakeKiosks]);
  await pool.query("DELETE FROM kiosks WHERE id = ANY($1)", [fakeKiosks]);
  
  console.log("Purged fake kiosks, printers, and demo jobs.");

  console.log("=== 2. ESTABLISHING SGU FOODCOURT PRODUCTION KIOSK (PB-K01) ===");

  // 1. Kiosk PB-K01 in kiosks table
  await pool.query(`
    INSERT INTO kiosks (
      id, name, location, enabled, maintenance, printing_paused,
      network_type, ip_address, backend_connected, is_demo, created_at
    ) VALUES (
      'PB-K01',
      'PrintBar SGU Foodcourt',
      'SGU Food Court, Kolhapur',
      true, false, false,
      'ethernet', '192.168.1.100', true, false, NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      name = 'PrintBar SGU Foodcourt',
      location = 'SGU Food Court, Kolhapur',
      enabled = true,
      is_demo = false
  `);

  // 2. Kiosk PB-K01 in devices table
  await pool.query(`
    INSERT INTO devices (
      id, name, location, secret_hash, is_active, kyocera_ready, canon_ready,
      paper_ready, kyocera_paper, canon_paper, maintenance_mode
    ) VALUES (
      'PB-K01',
      'PrintBar SGU Foodcourt',
      'SGU Food Court, Kolhapur',
      'demo', true, true, true,
      true, 250, 250, false
    )
    ON CONFLICT (id) DO UPDATE SET
      name = 'PrintBar SGU Foodcourt',
      location = 'SGU Food Court, Kolhapur',
      is_active = true
  `);

  // Remove any legacy devices like PB-K02, PB-K03
  await pool.query("DELETE FROM devices WHERE id NOT IN ('PB-K01')");

  console.log("=== 3. CONFIGURING EXACTLY TWO PRODUCTION PRINTERS ===");

  // Printer 1: Kyocera ECOSYS PA3500x
  await pool.query(`
    INSERT INTO printers (
      id, kiosk_id, name, model, ip, cups_queue,
      role, priority, enabled, paused, auto_failover,
      supports_color, paper_capacity, paper_remaining,
      paper_source, toner_black, toner_source, total_pages, created_at
    ) VALUES (
      'kyocera_pa3500x', 'PB-K01', 'Kyocera ECOSYS PA3500x', 'Kyocera ECOSYS PA3500x',
      '192.168.1.21', 'Kyocera_PA3500x',
      'primary', 1, true, false, true,
      false, 250, 250,
      'manual', 100, 'manual', 0, NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      kiosk_id = 'PB-K01',
      name = 'Kyocera ECOSYS PA3500x',
      model = 'Kyocera ECOSYS PA3500x',
      cups_queue = 'Kyocera_PA3500x',
      role = 'primary',
      priority = 1,
      enabled = true,
      auto_failover = true,
      supports_color = false,
      paper_capacity = 250
  `);

  // Printer 2: Canon MAXIFY GX6170
  await pool.query(`
    INSERT INTO printers (
      id, kiosk_id, name, model, ip, cups_queue,
      role, priority, enabled, paused, auto_failover,
      supports_color, paper_capacity, paper_remaining,
      paper_source, toner_black, toner_color, toner_source, total_pages, created_at
    ) VALUES (
      'canon_gx6170', 'PB-K01', 'Canon MAXIFY GX6170', 'Canon MAXIFY GX6170',
      '192.168.1.22', 'Canon_GX6170',
      'backup', 2, true, false, true,
      true, 250, 250,
      'manual', 100, 100, 'manual', 0, NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      kiosk_id = 'PB-K01',
      name = 'Canon MAXIFY GX6170',
      model = 'Canon MAXIFY GX6170',
      cups_queue = 'Canon_GX6170',
      role = 'backup',
      priority = 2,
      enabled = true,
      auto_failover = true,
      supports_color = true,
      paper_capacity = 250
  `);

  console.log("=== 4. VERIFYING SINGLE KIOSK AND TWO PRINTERS ===");
  const kRes = await pool.query("SELECT id, name, location, enabled FROM kiosks");
  console.log("Kiosks:", kRes.rows);
  const pRes = await pool.query("SELECT id, kiosk_id, name, model, cups_queue, role, paper_capacity, paper_remaining FROM printers");
  console.log("Printers:", pRes.rows);
  const dRes = await pool.query("SELECT id, name, location FROM devices");
  console.log("Devices:", dRes.rows);

  await pool.end();
  console.log("=== COMPLETED SGU CLEAN RESET ===");
}

purgeAndResetToSGU().catch((err) => {
  console.error("Purge error:", err);
  process.exit(1);
});
