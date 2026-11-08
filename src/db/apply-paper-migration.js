const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log('Connected to DB. Adding paper tracking columns to devices...');
  await client.query(`
    ALTER TABLE devices ADD COLUMN IF NOT EXISTS kyocera_paper integer NOT NULL DEFAULT 250;
    ALTER TABLE devices ADD COLUMN IF NOT EXISTS canon_paper integer NOT NULL DEFAULT 250;
    ALTER TABLE devices ADD COLUMN IF NOT EXISTS paper_ready boolean NOT NULL DEFAULT true;
    UPDATE devices SET kyocera_paper = 250, canon_paper = 250, paper_ready = true WHERE kyocera_paper IS NULL OR kyocera_paper = 0;
  `);
  console.log('Paper columns applied successfully!');
  const res = await client.query('SELECT id, kyocera_paper, canon_paper, paper_ready FROM devices;');
  console.log('Devices:', res.rows);
  await client.end();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
