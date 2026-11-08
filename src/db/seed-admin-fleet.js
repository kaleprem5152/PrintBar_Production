require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function seed() {
  const pw = hashPassword('PrintBar@2026');
  const users = [
    { email: 'super@printbar.in', name: 'Super Admin', role: 'super_admin' },
    { email: 'admin@printbar.in', name: 'System Admin', role: 'super_admin' },
    { email: 'ops@printbar.in', name: 'Operations Lead', role: 'ops_admin' },
    { email: 'finance@printbar.in', name: 'Finance Lead', role: 'finance_admin' },
    { email: 'maintenance@printbar.in', name: 'Maintenance Tech', role: 'maintenance' }
  ];

  // Make legacy username nullable
  await pool.query("ALTER TABLE admin_users ALTER COLUMN username DROP NOT NULL;");

  // Update id 1 if null email
  await pool.query(
    "UPDATE admin_users SET username = 'admin', email = 'admin@printbar.in', name = 'System Admin', password_hash = $1, role = 'super_admin', active = true, must_change_password = false WHERE id = 1",
    [pw]
  );

  for (const u of users) {
    if (u.email === 'admin@printbar.in') continue;
    const uname = u.email.split('@')[0];
    await pool.query(
      `INSERT INTO admin_users (username, email, name, role, password_hash, active, must_change_password)
       VALUES ($1, $2, $3, $4, $5, true, false)
       ON CONFLICT (email) DO UPDATE SET username = $1, password_hash = $5, role = $4, active = true`,
      [uname, u.email, u.name, u.role, pw]
    );
  }

  // Also seed real kiosk & printer entries if empty
  const { rows: kRows } = await pool.query('SELECT count(*) FROM kiosks');
  if (parseInt(kRows[0].count) === 0) {
    await pool.query(`
      INSERT INTO kiosks (id, name, location, enabled, maintenance, printing_paused, is_demo)
      VALUES ('PB-K01', 'PrintBar Kiosk 01', 'Central Library Ground Floor', true, false, false, false)
      ON CONFLICT (id) DO NOTHING
    `);
    console.log('Seeded kiosk PB-K01');
  }

  const { rows: pRows } = await pool.query('SELECT count(*) FROM printers');
  if (parseInt(pRows[0].count) === 0) {
    await pool.query(`
      INSERT INTO printers (id, kiosk_id, name, model, ip, cups_queue, role, priority, enabled, auto_failover, supports_color, paper_capacity, paper_remaining, paper_source, toner_black, toner_source, total_pages)
      VALUES 
        ('kyocera_pa3500x', 'PB-K01', 'Kyocera ECOSYS PA3500x', 'Kyocera ECOSYS PA3500x', '192.168.1.21', 'kyocera_pa3500x', 'primary', 1, true, true, false, 500, 500, 'manual', 85, 'telemetry', 1240),
        ('canon_gx6170', 'PB-K01', 'Canon GX6170 Colour', 'Canon MAXIFY GX6170', '192.168.1.22', 'canon_gx6170', 'backup', 2, true, true, true, 250, 250, 'manual', 90, 'telemetry', 820)
      ON CONFLICT (id) DO NOTHING
    `);
    console.log('Seeded Kyocera PA3500x and Canon GX6170 printers');
  }

  console.log('Seeding completed successfully!');
  await pool.end();
}

seed().catch(err => {
  console.error('Error seeding:', err);
  process.exit(1);
});
