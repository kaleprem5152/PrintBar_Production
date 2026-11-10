const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const { newDb } = require("pg-mem");

function normalizePrinter(raw) {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (v === "kyocera_pa3500x" || v === "printbar-kyocera" || v === "kyocera") return "kyocera_pa3500x";
  if (v === "canon_gx6170" || v === "printbar-canon" || v === "canon") return "canon_gx6170";
  return null;
}

function createTestPostgres() {
  const mem = newDb();
  mem.public.none(`
    CREATE TABLE devices (
      id text PRIMARY KEY,
      kyocera_paper integer NOT NULL DEFAULT 250,
      canon_paper integer NOT NULL DEFAULT 250,
      paper_ready boolean NOT NULL DEFAULT true
    );
    CREATE TABLE orders (
      order_id text PRIMARY KEY,
      status text NOT NULL DEFAULT 'paid',
      device_id text,
      color_mode text NOT NULL DEFAULT 'bw',
      copies integer NOT NULL DEFAULT 1,
      pages_per_sheet integer NOT NULL DEFAULT 1,
      pages_to_print integer NOT NULL DEFAULT 1,
      physical_sheets integer NOT NULL DEFAULT 1,
      pages_printed integer NOT NULL DEFAULT 0,
      sheets_printed integer NOT NULL DEFAULT 0,
      amount integer NOT NULL DEFAULT 20,
      rate_applied integer NOT NULL DEFAULT 2,
      docs jsonb NOT NULL DEFAULT '[]'::jsonb,
      printer_used text,
      fallback_printer text,
      cups_job_id text,
      refundable_amount integer DEFAULT 0,
      refund_status text DEFAULT 'NOT_REQUIRED',
      pin text DEFAULT '1234',
      failure_reason text
    );
    CREATE TABLE device_print_jobs (
      id serial PRIMARY KEY,
      attempt_id text NOT NULL,
      order_id text NOT NULL,
      attempt_no integer NOT NULL DEFAULT 1,
      doc_id text,
      job_ref text NOT NULL,
      device_id text NOT NULL,
      printer_name text NOT NULL,
      cups_job_id text,
      status text NOT NULL DEFAULT 'queued',
      is_fallback boolean NOT NULL DEFAULT false,
      pages_attempted integer NOT NULL DEFAULT 0,
      pages_confirmed integer NOT NULL DEFAULT 0,
      sheets_attempted integer NOT NULL DEFAULT 0,
      sheets_confirmed integer NOT NULL DEFAULT 0,
      failure_reason text
    );
    CREATE UNIQUE INDEX dpj_attempt_id_uidx ON device_print_jobs (attempt_id);
    CREATE UNIQUE INDEX dpj_order_attempt_no_uidx ON device_print_jobs (order_id, attempt_no);
    CREATE UNIQUE INDEX dpj_device_cups_uidx ON device_print_jobs (device_id, cups_job_id) WHERE cups_job_id IS NOT NULL;
    CREATE TABLE device_events (
      event_id text PRIMARY KEY,
      order_id text NOT NULL,
      device_id text NOT NULL,
      action text NOT NULL,
      payload jsonb
    );
  `);

  mem.public.none("INSERT INTO devices (id, kyocera_paper, canon_paper) VALUES ('PB-K01', 250, 250)");
  const { Pool } = mem.adapters.createPg();
  return new Pool();
}

function makeBackend(pool, opts = {}) {
  async function withTx(fn) {
    if (opts.injectDbFailure && opts.injectDbFailure()) {
      throw new Error("Simulated PostgreSQL outage");
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const res = await fn(client);
      await client.query("COMMIT");
      return res;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  return {
    async claimOrder({ orderId, deviceId }) {
      return withTx(async (tx) => {
        const upd = await tx.query(
          "UPDATE orders SET status = 'queued', device_id = $1 WHERE order_id = $2 AND status = 'paid' RETURNING *",
          [deviceId, orderId]
        );
        const claimed = upd.rows[0];
        if (!claimed) return { status: 409, error: "Not claimable" };

        const jobRef = `JOB-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
        const defaultPrinter = claimed.color_mode === "color" ? "canon_gx6170" : "kyocera_pa3500x";
        const docs = Array.isArray(claimed.docs) && claimed.docs.length > 0 ? claimed.docs : [{ id: null, pages: claimed.pages_to_print }];

        const attempts = [];
        for (let i = 0; i < docs.length; i++) {
          const doc = docs[i];
          const docPages = Number(doc.pages || 1) * Number(claimed.copies || 1);
          const attemptId = `ATT-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
          const ins = await tx.query(
            `INSERT INTO device_print_jobs
             (attempt_id, order_id, attempt_no, doc_id, job_ref, device_id, printer_name, status, is_fallback, pages_attempted, sheets_attempted)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', false, $8, $9) RETURNING *`,
            [attemptId, orderId, i + 1, doc.id, jobRef, deviceId, defaultPrinter, docPages, Math.ceil(docPages / (claimed.pages_per_sheet || 1))]
          );
          attempts.push(ins.rows[0]);
        }
        return { status: 200, orderId, jobRef, attempts };
      }).catch((e) => ({ status: 503, error: e.message }));
    },

    async createAttempt({ orderId, deviceId, eventId, printer, docId = null, isFallback = false, pagesAttempted, supersedeAttemptId = null, reason = null }) {
      const canonicalPrinter = normalizePrinter(printer);
      if (!canonicalPrinter) return { status: 400, error: "Invalid printer" };

      return withTx(async (tx) => {
        const dup = await tx.query("SELECT payload FROM device_events WHERE event_id = $1", [eventId]);
        if (dup.rows[0]) return { status: 200, duplicateEvent: true, ...(dup.rows[0].payload || {}) };

        if (supersedeAttemptId) {
          const prior = await tx.query("SELECT * FROM device_print_jobs WHERE attempt_id = $1", [supersedeAttemptId]);
          const p = prior.rows[0];
          if (!p || p.order_id !== orderId || p.device_id !== deviceId) return { status: 404, error: "Prior attempt not found" };
          if (p.status === "queued" || p.status === "printing") {
            await tx.query(
              "UPDATE device_print_jobs SET status = 'superseded', failure_reason = $1 WHERE attempt_id = $2",
              [reason || "Superseded", supersedeAttemptId]
            );
          }
        }

        const existing = await tx.query("SELECT attempt_no, job_ref FROM device_print_jobs WHERE order_id = $1", [orderId]);
        const maxNo = existing.rows.reduce((m, r) => Math.max(m, r.attempt_no), 0);
        const jobRef = existing.rows[0]?.job_ref || "JOB-NEW";
        const attemptId = `ATT-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;

        const ins = await tx.query(
          `INSERT INTO device_print_jobs
           (attempt_id, order_id, attempt_no, doc_id, job_ref, device_id, printer_name, status, is_fallback, pages_attempted, sheets_attempted)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', $8, $9, $9) RETURNING *`,
          [attemptId, orderId, maxNo + 1, docId, jobRef, deviceId, canonicalPrinter, isFallback, pagesAttempted || 1]
        );
        await tx.query(
          "INSERT INTO device_events (event_id, order_id, device_id, action, payload) VALUES ($1, $2, $3, 'attempt', $4)",
          [eventId, orderId, deviceId, JSON.stringify({ attemptId, attemptNo: maxNo + 1, printerName: canonicalPrinter })]
        );
        return { status: 200, attemptId, attemptNo: maxNo + 1, printerName: canonicalPrinter, row: ins.rows[0] };
      }).catch((e) => ({ status: 503, error: e.message }));
    },

    async bindAttempt({ orderId, deviceId, eventId, attemptId, printer, cupsJobId }) {
      const canonicalPrinter = normalizePrinter(printer);
      if (!canonicalPrinter || !attemptId || !cupsJobId) return { status: 400, error: "Missing required bind fields" };

      return withTx(async (tx) => {
        const dup = await tx.query("SELECT payload FROM device_events WHERE event_id = $1", [eventId]);
        if (dup.rows[0]) return { status: 200, duplicateEvent: true, ...(dup.rows[0].payload || {}) };

        const attRes = await tx.query("SELECT * FROM device_print_jobs WHERE attempt_id = $1", [attemptId]);
        const att = attRes.rows[0];
        if (!att || att.order_id !== orderId || att.device_id !== deviceId) return { status: 404, error: "Attempt not found" };
        if (att.printer_name !== canonicalPrinter) return { status: 422, error: "Printer mismatch" };
        if (att.status !== "queued" && att.status !== "printing") return { status: 409, error: "Attempt inactive" };

        if (att.cups_job_id) {
          if (att.cups_job_id === cupsJobId) return { status: 200, alreadyBound: true };
          return { status: 409, error: "Attempt already bound to different CUPS job" };
        }

        const conflict = await tx.query(
          "SELECT attempt_id FROM device_print_jobs WHERE device_id = $1 AND cups_job_id = $2",
          [deviceId, cupsJobId]
        );
        if (conflict.rows[0] && conflict.rows[0].attempt_id !== attemptId) {
          return { status: 409, error: "CUPS job already claimed by another attempt" };
        }

        await tx.query(
          "UPDATE device_print_jobs SET cups_job_id = $1, status = 'printing' WHERE attempt_id = $2",
          [cupsJobId, attemptId]
        );
        await tx.query(
          "INSERT INTO device_events (event_id, order_id, device_id, action, payload) VALUES ($1, $2, $3, 'bind', $4)",
          [eventId, orderId, deviceId, JSON.stringify({ attemptId, cupsJobId, printerName: canonicalPrinter })]
        );
        await tx.query(
          "UPDATE orders SET status = CASE WHEN status IN ('queued','processing','fallback_pending') THEN 'printing' ELSE status END WHERE order_id = $1",
          [orderId]
        );
        return { status: 200, attemptId, cupsJobId };
      }).catch((e) => {
        if (e.code === "23505" || String(e.message).includes("unique")) {
          return { status: 409, error: "Unique constraint violation on CUPS job ownership" };
        }
        return { status: 503, error: e.message };
      });
    },

    async progress({ orderId, deviceId, eventId, attemptId, printer, cupsJobId, pagesPrinted }) {
      const canonicalPrinter = normalizePrinter(printer);
      if (!canonicalPrinter) return { status: 400, error: "Invalid printer" };
      if (!attemptId || !cupsJobId) return { status: 400, error: "Missing attemptId or cupsJobId" };

      return withTx(async (tx) => {
        const dup = await tx.query("SELECT payload FROM device_events WHERE event_id = $1", [eventId]);
        if (dup.rows[0]) return { status: 200, duplicateEvent: true, ...(dup.rows[0].payload || {}) };

        const attRes = await tx.query("SELECT * FROM device_print_jobs WHERE attempt_id = $1", [attemptId]);
        const att = attRes.rows[0];
        if (!att || att.order_id !== orderId || att.device_id !== deviceId) return { status: 404, error: "Attempt not found" };
        if (att.printer_name !== canonicalPrinter) return { status: 422, error: "Printer mismatch" };
        if (!att.cups_job_id || att.cups_job_id !== cupsJobId) return { status: 422, error: "CUPS job ownership mismatch" };
        if (att.status !== "queued" && att.status !== "printing") return { status: 409, error: `Attempt in state '${att.status}'` };

        const ord = (await tx.query("SELECT * FROM orders WHERE order_id = $1", [orderId])).rows[0];
        const cap = att.pages_attempted > 0 ? att.pages_attempted : ord.pages_to_print;
        const monotonicPages = Math.max(att.pages_confirmed, Math.min(cap, pagesPrinted));

        await tx.query(
          "UPDATE device_print_jobs SET pages_confirmed = $1, status = 'printing' WHERE attempt_id = $2",
          [monotonicPages, attemptId]
        );
        await tx.query(
          "INSERT INTO device_events (event_id, order_id, device_id, action, payload) VALUES ($1, $2, $3, 'progress', $4)",
          [eventId, orderId, deviceId, JSON.stringify({ attemptId, pagesConfirmed: monotonicPages })]
        );
        return { status: 200, attemptId, pagesConfirmed: monotonicPages };
      }).catch((e) => ({ status: 503, error: e.message }));
    },

    async complete({ orderId, bodyOrderId, deviceId, eventId, attemptId, printer, cupsJobId, pagesPrinted }) {
      if (bodyOrderId && bodyOrderId !== orderId) return { status: 422, error: "Order ID mismatch" };
      const canonicalPrinter = normalizePrinter(printer);
      if (!canonicalPrinter) return { status: 400, error: "Foreign or invalid printer" };
      if (!attemptId || !cupsJobId) return { status: 400, error: "Missing attemptId or cupsJobId" };

      return withTx(async (tx) => {
        const dup = await tx.query("SELECT payload FROM device_events WHERE event_id = $1", [eventId]);
        if (dup.rows[0]) return { status: 200, duplicateEvent: true, ...(dup.rows[0].payload || {}) };

        const attRes = await tx.query("SELECT * FROM device_print_jobs WHERE attempt_id = $1", [attemptId]);
        const att = attRes.rows[0];
        if (!att || att.order_id !== orderId || att.device_id !== deviceId) return { status: 404, error: "Attempt not found" };
        if (att.printer_name !== canonicalPrinter) return { status: 422, error: "Printer mismatch" };
        if (!att.cups_job_id || att.cups_job_id !== cupsJobId) return { status: 422, error: "CUPS job ownership mismatch" };

        if (att.status === "completed" || att.status === "partial") {
          await tx.query(
            "INSERT INTO device_events (event_id, order_id, device_id, action, payload) VALUES ($1, $2, $3, 'complete', $4)",
            [eventId, orderId, deviceId, JSON.stringify({ attemptId, alreadyCompleted: true })]
          );
          return { status: 200, alreadyCompleted: true };
        }

        if (att.status !== "queued" && att.status !== "printing") {
          return { status: 409, error: `Cannot complete inactive attempt in state '${att.status}'` };
        }

        const ord = (await tx.query("SELECT * FROM orders WHERE order_id = $1", [orderId])).rows[0];
        const expected = att.pages_attempted > 0 ? att.pages_attempted : ord.pages_to_print;
        const verifiedPages = Math.min(expected, Math.max(0, pagesPrinted));
        const isPartial = verifiedPages < expected;
        const attemptStatus = isPartial ? "partial" : "completed";
        const sheetsConsumed = Math.max(1, Math.ceil(verifiedPages / (ord.pages_per_sheet || 1)));

        await tx.query(
          "UPDATE device_print_jobs SET status = $1, pages_confirmed = $2, sheets_confirmed = $3 WHERE attempt_id = $4",
          [attemptStatus, verifiedPages, sheetsConsumed, attemptId]
        );

        const allAtts = (await tx.query("SELECT * FROM device_print_jobs WHERE order_id = $1", [orderId])).rows;
        const confirmed = allAtts.filter((a) => a.status === "completed" || a.status === "partial");
        const totalPages = Math.min(ord.pages_to_print, confirmed.reduce((s, a) => s + a.pages_confirmed, 0));
        const totalSheets = confirmed.reduce((s, a) => s + a.sheets_confirmed, 0);

        let orderStatus = "printing";
        if (isPartial) orderStatus = "refund_pending";
        else if (totalPages >= ord.pages_to_print) orderStatus = "completed";

        await tx.query(
          "UPDATE orders SET status = $1, pages_printed = $2, sheets_printed = $3, printer_used = $4, cups_job_id = $5 WHERE order_id = $6",
          [orderStatus, totalPages, totalSheets, canonicalPrinter, cupsJobId, orderId]
        );

        const devRow = (await tx.query("SELECT kyocera_paper, canon_paper FROM devices WHERE id = $1", [deviceId])).rows[0];
        if (devRow) {
          const newKyocera = canonicalPrinter === "canon_gx6170" ? devRow.kyocera_paper : Math.max(0, devRow.kyocera_paper - sheetsConsumed);
          const newCanon = canonicalPrinter === "canon_gx6170" ? Math.max(0, devRow.canon_paper - sheetsConsumed) : devRow.canon_paper;
          await tx.query("UPDATE devices SET kyocera_paper = $1, canon_paper = $2 WHERE id = $3", [newKyocera, newCanon, deviceId]);
        }

        await tx.query(
          "INSERT INTO device_events (event_id, order_id, device_id, action, payload) VALUES ($1, $2, $3, 'complete', $4)",
          [eventId, orderId, deviceId, JSON.stringify({ attemptId, orderStatus, totalPages, sheetsConsumed })]
        );

        return { status: 200, attemptId, attemptStatus, orderStatus, totalPages, sheetsConsumed };
      }).catch((e) => ({ status: 503, error: e.message }));
    },

    async fail({ orderId, deviceId, eventId, attemptId, reason }) {
      return withTx(async (tx) => {
        if (attemptId) {
          await tx.query(
            "UPDATE device_print_jobs SET status = 'failed', failure_reason = $1 WHERE attempt_id = $2 AND order_id = $3 AND device_id = $4",
            [reason, attemptId, orderId, deviceId]
          );
        }
        await tx.query("INSERT INTO device_events (event_id, order_id, device_id, action, payload) VALUES ($1, $2, $3, 'fail', '{}')", [eventId, orderId, deviceId]);
        return { status: 200, attemptId };
      }).catch((e) => ({ status: 503, error: e.message }));
    },
  };
}

test("Scenario 1 & 2: Multi-document order & multiple CUPS jobs isolate attempt lifecycles", async () => {
  const pool = createTestPostgres();
  const api = makeBackend(pool);
  await pool.query(
    "INSERT INTO orders (order_id, status, pages_to_print, physical_sheets, docs) VALUES ('ORD-MD-1', 'paid', 10, 10, $1)",
    [JSON.stringify([{ id: "doc_A", pages: 4 }, { id: "doc_B", pages: 6 }])]
  );

  const claim = await api.claimOrder({ orderId: "ORD-MD-1", deviceId: "PB-K01" });
  assert.strictEqual(claim.status, 200);
  assert.strictEqual(claim.attempts.length, 2);
  const [att1, att2] = claim.attempts;
  assert.notStrictEqual(att1.attempt_id, att2.attempt_id);

  // Bind and complete Doc A (4 pages)
  assert.strictEqual((await api.bindAttempt({ orderId: "ORD-MD-1", deviceId: "PB-K01", eventId: "evt_bind_doc1", attemptId: att1.attempt_id, printer: "kyocera_pa3500x", cupsJobId: "kyocera-101" })).status, 200);
  const comp1 = await api.complete({ orderId: "ORD-MD-1", deviceId: "PB-K01", eventId: "evt_comp_doc1", attemptId: att1.attempt_id, printer: "kyocera_pa3500x", cupsJobId: "kyocera-101", pagesPrinted: 4 });
  assert.strictEqual(comp1.status, 200);
  assert.strictEqual(comp1.orderStatus, "printing"); // Doc B still pending!

  // Bind and complete Doc B (6 pages)
  assert.strictEqual((await api.bindAttempt({ orderId: "ORD-MD-1", deviceId: "PB-K01", eventId: "evt_bind_doc2", attemptId: att2.attempt_id, printer: "kyocera_pa3500x", cupsJobId: "kyocera-102" })).status, 200);
  const comp2 = await api.complete({ orderId: "ORD-MD-1", deviceId: "PB-K01", eventId: "evt_comp_doc2", attemptId: att2.attempt_id, printer: "kyocera_pa3500x", cupsJobId: "kyocera-102", pagesPrinted: 6 });
  assert.strictEqual(comp2.status, 200);
  assert.strictEqual(comp2.orderStatus, "completed");
  assert.strictEqual(comp2.totalPages, 10);

  const dev = (await pool.query("SELECT kyocera_paper, canon_paper FROM devices WHERE id = 'PB-K01'")).rows[0];
  assert.strictEqual(dev.kyocera_paper, 240);
  assert.strictEqual(dev.canon_paper, 250);
});

test("Scenario 3 & 4: Primary Kyocera failed attempt followed by Canon fallback preserves history & isolates Canon paper", async () => {
  const pool = createTestPostgres();
  const api = makeBackend(pool);
  await pool.query("INSERT INTO orders (order_id, status, pages_to_print, physical_sheets, docs) VALUES ('ORD-FB-1', 'paid', 5, 5, $1)", [JSON.stringify([{ id: "doc1", pages: 5 }])]);

  const claim = await api.claimOrder({ orderId: "ORD-FB-1", deviceId: "PB-K01" });
  const att1 = claim.attempts[0];
  await api.bindAttempt({ orderId: "ORD-FB-1", deviceId: "PB-K01", eventId: "evt_fb_b1", attemptId: att1.attempt_id, printer: "kyocera_pa3500x", cupsJobId: "kyocera-301" });
  await api.fail({ orderId: "ORD-FB-1", deviceId: "PB-K01", eventId: "evt_fb_f1", attemptId: att1.attempt_id, reason: "paper_jam_at_0" });

  // Create new Canon fallback attempt
  const fb = await api.createAttempt({ orderId: "ORD-FB-1", deviceId: "PB-K01", eventId: "evt_fb_new", printer: "canon_gx6170", isFallback: true, pagesAttempted: 5 });
  assert.strictEqual(fb.status, 200);
  assert.strictEqual(fb.attemptNo, 2);

  await api.bindAttempt({ orderId: "ORD-FB-1", deviceId: "PB-K01", eventId: "evt_fb_b2", attemptId: fb.attemptId, printer: "canon_gx6170", cupsJobId: "canon-401" });
  const comp = await api.complete({ orderId: "ORD-FB-1", deviceId: "PB-K01", eventId: "evt_fb_c2", attemptId: fb.attemptId, printer: "canon_gx6170", cupsJobId: "canon-401", pagesPrinted: 5 });
  assert.strictEqual(comp.orderStatus, "completed");

  // Verify old Kyocera attempt retained its cups_job_id and Canon paper deducted ONLY
  const rows = (await pool.query("SELECT attempt_id, attempt_no, cups_job_id, status FROM device_print_jobs WHERE order_id = 'ORD-FB-1' ORDER BY attempt_no")).rows;
  assert.strictEqual(rows[0].cups_job_id, "kyocera-301");
  assert.strictEqual(rows[0].status, "failed");
  assert.strictEqual(rows[1].cups_job_id, "canon-401");
  assert.strictEqual(rows[1].status, "completed");

  const dev = (await pool.query("SELECT kyocera_paper, canon_paper FROM devices WHERE id = 'PB-K01'")).rows[0];
  assert.strictEqual(dev.kyocera_paper, 250);
  assert.strictEqual(dev.canon_paper, 245);
});

test("Scenario 5 & 6: Duplicate progress & duplicate completion events are idempotent without double deduction", async () => {
  const pool = createTestPostgres();
  const api = makeBackend(pool);
  await pool.query("INSERT INTO orders (order_id, status, pages_to_print, physical_sheets, docs) VALUES ('ORD-DUP-1', 'paid', 6, 6, $1)", [JSON.stringify([{ id: "d1", pages: 6 }])]);

  const att = (await api.claimOrder({ orderId: "ORD-DUP-1", deviceId: "PB-K01" })).attempts[0];
  await api.bindAttempt({ orderId: "ORD-DUP-1", deviceId: "PB-K01", eventId: "evt_dup_b1", attemptId: att.attempt_id, printer: "kyocera_pa3500x", cupsJobId: "kyocera-501" });

  // Progress 4, then duplicate eventId, then stale regression 2
  const p1 = await api.progress({ orderId: "ORD-DUP-1", deviceId: "PB-K01", eventId: "evt_prog_1", attemptId: att.attempt_id, printer: "kyocera_pa3500x", cupsJobId: "kyocera-501", pagesPrinted: 4 });
  assert.strictEqual(p1.pagesConfirmed, 4);
  const pDup = await api.progress({ orderId: "ORD-DUP-1", deviceId: "PB-K01", eventId: "evt_prog_1", attemptId: att.attempt_id, printer: "kyocera_pa3500x", cupsJobId: "kyocera-501", pagesPrinted: 4 });
  assert.strictEqual(pDup.duplicateEvent, true);
  const pStale = await api.progress({ orderId: "ORD-DUP-1", deviceId: "PB-K01", eventId: "evt_prog_2", attemptId: att.attempt_id, printer: "kyocera_pa3500x", cupsJobId: "kyocera-501", pagesPrinted: 2 });
  assert.strictEqual(pStale.pagesConfirmed, 4);

  // Complete once, replay same eventId, then replay with new eventId
  const c1 = await api.complete({ orderId: "ORD-DUP-1", deviceId: "PB-K01", eventId: "evt_comp_1", attemptId: att.attempt_id, printer: "kyocera_pa3500x", cupsJobId: "kyocera-501", pagesPrinted: 6 });
  assert.strictEqual(c1.orderStatus, "completed");
  const c2 = await api.complete({ orderId: "ORD-DUP-1", deviceId: "PB-K01", eventId: "evt_comp_1", attemptId: att.attempt_id, printer: "kyocera_pa3500x", cupsJobId: "kyocera-501", pagesPrinted: 6 });
  assert.strictEqual(c2.duplicateEvent, true);
  const c3 = await api.complete({ orderId: "ORD-DUP-1", deviceId: "PB-K01", eventId: "evt_comp_new_id", attemptId: att.attempt_id, printer: "kyocera_pa3500x", cupsJobId: "kyocera-501", pagesPrinted: 6 });
  assert.strictEqual(c3.alreadyCompleted, true);

  // Paper deducted ONLY ONCE (250 - 6 = 244)
  const dev = (await pool.query("SELECT kyocera_paper FROM devices WHERE id = 'PB-K01'")).rows[0];
  assert.strictEqual(dev.kyocera_paper, 244);
});

test("Scenario 7: Late completion or progress from earlier superseded/failed attempt cannot modify newer attempt", async () => {
  const pool = createTestPostgres();
  const api = makeBackend(pool);
  await pool.query("INSERT INTO orders (order_id, status, pages_to_print, physical_sheets, docs) VALUES ('ORD-LATE-1', 'paid', 5, 5, $1)", [JSON.stringify([{ id: "d1", pages: 5 }])]);

  const att1 = (await api.claimOrder({ orderId: "ORD-LATE-1", deviceId: "PB-K01" })).attempts[0];
  await api.bindAttempt({ orderId: "ORD-LATE-1", deviceId: "PB-K01", eventId: "evt_late_b1", attemptId: att1.attempt_id, printer: "kyocera_pa3500x", cupsJobId: "kyocera-601" });

  // Supersede att1 with att2 on Canon
  const att2 = await api.createAttempt({ orderId: "ORD-LATE-1", deviceId: "PB-K01", eventId: "evt_late_new", printer: "canon_gx6170", isFallback: true, pagesAttempted: 5, supersedeAttemptId: att1.attempt_id });
  await api.bindAttempt({ orderId: "ORD-LATE-1", deviceId: "PB-K01", eventId: "evt_late_b2", attemptId: att2.attemptId, printer: "canon_gx6170", cupsJobId: "canon-602" });

  // Late progress & late completion from att1 rejected with 409!
  const lateProg = await api.progress({ orderId: "ORD-LATE-1", deviceId: "PB-K01", eventId: "evt_late_p1", attemptId: att1.attempt_id, printer: "kyocera_pa3500x", cupsJobId: "kyocera-601", pagesPrinted: 5 });
  assert.strictEqual(lateProg.status, 409);

  const lateComp = await api.complete({ orderId: "ORD-LATE-1", deviceId: "PB-K01", eventId: "evt_late_c1", attemptId: att1.attempt_id, printer: "kyocera_pa3500x", cupsJobId: "kyocera-601", pagesPrinted: 5 });
  assert.strictEqual(lateComp.status, 409);

  // Newer att2 must remain in 'printing' untouched, order untouched
  const att2Row = (await pool.query("SELECT status FROM device_print_jobs WHERE attempt_id = $1", [att2.attemptId])).rows[0];
  assert.strictEqual(att2Row.status, "printing");
  const dev = (await pool.query("SELECT kyocera_paper, canon_paper FROM devices WHERE id = 'PB-K01'")).rows[0];
  assert.strictEqual(dev.kyocera_paper, 250);
  assert.strictEqual(dev.canon_paper, 250);
});

test("Scenario 8, 9, 10: Wrong CUPS job ID, wrong printer ID, wrong device or order ID all rejected", async () => {
  const pool = createTestPostgres();
  const api = makeBackend(pool);
  await pool.query("INSERT INTO orders (order_id, status, pages_to_print, physical_sheets, docs) VALUES ('ORD-MIS-1', 'paid', 3, 3, $1)", [JSON.stringify([{ id: "d1", pages: 3 }])]);

  const att = (await api.claimOrder({ orderId: "ORD-MIS-1", deviceId: "PB-K01" })).attempts[0];
  await api.bindAttempt({ orderId: "ORD-MIS-1", deviceId: "PB-K01", eventId: "evt_mis_b1", attemptId: att.attempt_id, printer: "kyocera_pa3500x", cupsJobId: "kyocera-701" });

  // Wrong CUPS job ID (Scenario 8)
  const badCups = await api.complete({ orderId: "ORD-MIS-1", deviceId: "PB-K01", eventId: "evt_mis_c1", attemptId: att.attempt_id, printer: "kyocera_pa3500x", cupsJobId: "kyocera-OTHER-999", pagesPrinted: 3 });
  assert.strictEqual(badCups.status, 422);

  // Wrong printer ID (Scenario 9)
  const badPrn1 = await api.complete({ orderId: "ORD-MIS-1", deviceId: "PB-K01", eventId: "evt_mis_c2", attemptId: att.attempt_id, printer: "canon_gx6170", cupsJobId: "kyocera-701", pagesPrinted: 3 });
  assert.strictEqual(badPrn1.status, 422);
  const badPrn2 = await api.complete({ orderId: "ORD-MIS-1", deviceId: "PB-K01", eventId: "evt_mis_c3", attemptId: att.attempt_id, printer: "unknown_hp", cupsJobId: "kyocera-701", pagesPrinted: 3 });
  assert.strictEqual(badPrn2.status, 400);

  // Wrong device or wrong order ID (Scenario 10)
  const badDev = await api.complete({ orderId: "ORD-MIS-1", deviceId: "PB-K99", eventId: "evt_mis_c4", attemptId: att.attempt_id, printer: "kyocera_pa3500x", cupsJobId: "kyocera-701", pagesPrinted: 3 });
  assert.strictEqual(badDev.status, 404);
  const badOrd = await api.complete({ orderId: "ORD-MIS-1", bodyOrderId: "ORD-WRONG", deviceId: "PB-K01", eventId: "evt_mis_c5", attemptId: att.attempt_id, printer: "kyocera_pa3500x", cupsJobId: "kyocera-701", pagesPrinted: 3 });
  assert.strictEqual(badOrd.status, 422);
});

test("Scenario 11: Simultaneous attempts trying to claim the same CUPS job ID rejected by unique index", async () => {
  const pool = createTestPostgres();
  const api = makeBackend(pool);
  await pool.query("INSERT INTO orders (order_id, status, pages_to_print, physical_sheets, docs) VALUES ('ORD-RACE-1', 'paid', 4, 4, $1)", [JSON.stringify([{ id: "d1", pages: 2 }, { id: "d2", pages: 2 }])]);

  const [a1, a2] = (await api.claimOrder({ orderId: "ORD-RACE-1", deviceId: "PB-K01" })).attempts;
  const [r1, r2] = await Promise.all([
    api.bindAttempt({ orderId: "ORD-RACE-1", deviceId: "PB-K01", eventId: "evt_race_1", attemptId: a1.attempt_id, printer: "kyocera_pa3500x", cupsJobId: "kyocera-SHARED-888" }),
    api.bindAttempt({ orderId: "ORD-RACE-1", deviceId: "PB-K01", eventId: "evt_race_2", attemptId: a2.attempt_id, printer: "kyocera_pa3500x", cupsJobId: "kyocera-SHARED-888" }),
  ]);

  const statuses = [r1.status, r2.status].sort();
  assert.deepStrictEqual(statuses, [200, 409]);

  // Also test direct SQL constraint dpj_device_cups_uidx rejects duplicate insertion even bypassing app check
  await assert.rejects(
    pool.query("UPDATE device_print_jobs SET cups_job_id = 'kyocera-SHARED-888' WHERE attempt_id = $1", [r1.status === 200 ? a2.attempt_id : a1.attempt_id])
  );
});

test("Scenario 12: Database failures during attempt creation and completion roll back atomically (503)", async () => {
  const pool = createTestPostgres();
  let failNext = false;
  const api = makeBackend(pool, { injectDbFailure: () => failNext });
  await pool.query("INSERT INTO orders (order_id, status, pages_to_print, physical_sheets, docs) VALUES ('ORD-DBERR-1', 'paid', 5, 5, $1)", [JSON.stringify([{ id: "d1", pages: 5 }])]);

  const att = (await api.claimOrder({ orderId: "ORD-DBERR-1", deviceId: "PB-K01" })).attempts[0];
  await api.bindAttempt({ orderId: "ORD-DBERR-1", deviceId: "PB-K01", eventId: "evt_dbe_b1", attemptId: att.attempt_id, printer: "kyocera_pa3500x", cupsJobId: "kyocera-901" });

  // Inject DB failure on attempt creation
  failNext = true;
  const createFail = await api.createAttempt({ orderId: "ORD-DBERR-1", deviceId: "PB-K01", eventId: "evt_dbe_att", printer: "canon_gx6170", isFallback: true, pagesAttempted: 5 });
  assert.strictEqual(createFail.status, 503);
  failNext = false;
  const countAfterFail = (await pool.query("SELECT count(*)::int AS c FROM device_print_jobs WHERE order_id = 'ORD-DBERR-1'")).rows[0].c;
  assert.strictEqual(countAfterFail, 1);

  // Inject DB failure on completion
  failNext = true;
  const compFail = await api.complete({ orderId: "ORD-DBERR-1", deviceId: "PB-K01", eventId: "evt_dbe_comp", attemptId: att.attempt_id, printer: "kyocera_pa3500x", cupsJobId: "kyocera-901", pagesPrinted: 5 });
  assert.strictEqual(compFail.status, 503);
  failNext = false;

  // Verify no partial paper deduction and order remains 'printing'
  const dev = (await pool.query("SELECT kyocera_paper FROM devices WHERE id = 'PB-K01'")).rows[0];
  assert.strictEqual(dev.kyocera_paper, 250);
  const ord = (await pool.query("SELECT status FROM orders WHERE order_id = 'ORD-DBERR-1'")).rows[0];
  assert.strictEqual(ord.status, "printing");
});
