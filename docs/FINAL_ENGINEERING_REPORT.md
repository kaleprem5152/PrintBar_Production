# PRINTBAR — MASTER PRODUCTION ENGINEERING REPORT

**Project:** PrintBar Autonomous University Printing Kiosk  
**Target Hardware:** Raspberry Pi 5 (8GB) — PB-K01, SGU Food Court, Sanjay Ghodawat University, Kolhapur  
**Printers:** Kyocera ECOSYS PA3500x (Primary B&W) & Canon MAXIFY GX6170 (Colour & Fallback)  
**Production URL:** `https://printbarproduction-production.up.railway.app`  
**GitHub Repository:** `https://github.com/kaleprem5152/PrintBar_Production`  
**Date:** November 10, 2026  
**Final Status:** `CODE READY — HARDWARE VALIDATION REQUIRED`

---

## SECTION A — SYSTEM ARCHITECTURE OVERVIEW

The PrintBar system comprises three tightly coupled, hardened layers:

1. **Cloud Backend & Admin Control Centre (Next.js 16 App Router on Railway & Supabase PostgreSQL)**:
   - Complete self-service customer workflow: Document upload, server-side preflight & setting validation, dynamic pricing engine (₹2/B&W sheet, ₹8/Colour sheet), Cashfree payment integration with webhook HMAC verification, collection PIN issuance.
   - Dedicated Admin Control Centre: Real-time printer health, live telemetry, paper inventory management with +250 refill triggers, remote CUPS maintenance actions, full audit logs, and role-based authentication (`super_admin`, `ops_admin`, `finance_admin`, `maintenance`).
   - Authoritative Single Source of Truth: Canonical HMAC-SHA256 authentication for all agent endpoints (`authenticateDevice`) using `METHOD:PATH:TIMESTAMP:NONCE:BODY_SHA256`, with durable PostgreSQL `device_nonces` replay protection and fail-closed `device_events` idempotency.
   - **Strict Individual Print-Attempt Identity (`device_print_jobs`)**: Every individual print attempt receives a unique backend-generated `attempt_id`, sequential `attempt_no`, optional `doc_id`, lifecycle `status`, and a PostgreSQL partial unique index `dpj_device_cups_uidx (device_id, cups_job_id) WHERE cups_job_id IS NOT NULL` guaranteeing 1-to-1 CUPS job ownership.

2. **Raspberry Pi Autonomous Hardware Daemon (`agent.py` v4.0)**:
   - Runs under isolated `printbar` system user in `/opt/printbar/agent` with systemd supervision (`printbar-agent.service`). Customer display (`printbar-kiosk.service`) is conditionally gated behind hardware/queue/credential/display preflight checks.
   - Durable SQLite database (`agent.db`, schema v6) with Write-Ahead Logging (`WAL`), foreign keys, unique CUPS job index (`idx_pa_cups_job_id`), unique `attempt_id` index (`idx_pa_attempt_id`), and FIFO durable outbox (`ORDER BY created_at ASC, id ASC`) with jittered exponential backoff.
   - Retains the exact `attempt_id`, `printer_queue`, and `cups_job_id` through submission, CUPS binding (`?action=bind`), progress (`PATCH`), completion (`?action=complete`), outbox retries, and crash recovery.
   - Startup crash recovery reconciles persisted `print_attempts` rows against CUPS without minting duplicate attempt identities for already-submitted physical jobs, flagging uncertain output for `MANUAL_REVIEW`.

3. **Print Execution & CUPS Subsystem (`cups_manager.py` & `printer_monitor.py`)**:
   - Native IPP Everywhere Ethernet connection (`ipp://<IP>:631/ipp/print`). Zero simulation mode (`sim-*` removed).
   - Validated IPP binary response parser with boundary checks returning explicit `UNKNOWN` (`source="ipp_parse_error"`) on truncated or malformed frames.
   - Uncertain CUPS submissions (exit 0 without `request id is`) classify as `UNKNOWN/RECONCILIATION_REQUIRED` and halt for `MANUAL_REVIEW` without auto-reprint.

---

## SECTION B — DEFECT & BLOCKER RESOLUTION SUMMARY

| Blocker / Defect | Issue Description | Hardened Resolution |
| :--- | :--- | :--- |
| **Attempt Identity & CUPS Ownership** | Attempts identified only by `(orderId, deviceId)` with `.limit(1)` and bulk updates overwriting historical `cupsJobId`s | Added `attempt_id` (`dpj_attempt_id_uidx`), `(order_id, attempt_no)` (`dpj_order_attempt_no_uidx`), `doc_id`, `status`, and `(device_id, cups_job_id)` unique index (`dpj_device_cups_uidx`). Added `?action=attempt` and `?action=bind` endpoints; `PATCH` and `?action=complete` resolve strictly by unique `attemptId`, validate `(orderId, deviceId, printer, cupsJobId, status)`, and reject late/mismatched/duplicate events. |
| **Inventory Isolation & Partial Completion** | Fallback or queue aliases could deduct wrong tray; partial output could mark order `completed` | Normalized printer names (`kyocera_pa3500x` vs `canon_gx6170`) enforced across attempts, device tray deductions, and fleet stats. Partial attempts route to `partial` / `refund_pending` / `requires_manual_review` and only complete full multi-doc orders once verified pages reach `pagesToPrint`. |
| **Fail-Closed Event Idempotency** | Swallowed `device_events` exceptions could risk duplicate deductions | Database lookup/insert failures reject with HTTP 503 so the agent outbox retries safely. |
| **IPP Parsing & Uncertain CUPS** | Truncated IPP frames or unparseable `lp` outputs risked false readiness or success | Fixed `val_len` offset & boundary validation in `printer_monitor.py`; `cups_manager.py` yields `UNKNOWN/RECONCILIATION_REQUIRED` halting for `MANUAL_REVIEW`. |
| **Conditional Kiosk Startup** | Unconditional `printbar-kiosk.service` enabling could launch unconfigured kiosk UI on reboot | `install.sh` and `start-kiosk.sh` gate kiosk enable/start on config, secret, CUPS daemon, active queues, Chromium, and graphical display; failures disable `printbar-kiosk.service` while keeping `printbar-agent.service` active for diagnostics. |

---

## SECTION C — VERIFIED AUTOMATED SOFTWARE RESULTS

> **Important Distinction:** All checks below were executed on **software, simulated PostgreSQL (`pg-mem`), mocked CUPS/IPP fixtures, and live cloud schema verification** on the Windows development environment. Physical Raspberry Pi 5, physical Kyocera PA3500x, and physical Canon GX6170 hardware validation has **not** yet been executed.

### 1. Python Agent Test Suite (`pytest`)
Command: `python -m pytest tests/ -v` (in `raspberry-pi-agent`, verified on Python 3.14.6)
```text
tests/test_agent.py                 (5 / 5 PASSED)
tests/test_auth.py                  (5 / 5 PASSED — Shared Python/TypeScript HMAC vector verified)
tests/test_config.py                (6 / 6 PASSED)
tests/test_cups_manager.py          (7 / 7 PASSED — includes unparseable lp output check)
tests/test_db.py                    (5 / 5 PASSED)
tests/test_printer_monitor.py       (9 / 9 PASSED — includes valid/truncated/malformed IPP tests)
tests/test_production_defects.py    (16 / 16 PASSED — multi-doc attempt isolation, preflight Canon fallback, SQLite unique CUPS index, crash recovery, outbox, command leases)

Total: 53 Passed | 0 Failed | 0 Skipped (1.71s)
```

### 2. Backend & Database Regression Suite (`node --test`)
Command: `npm test` (`node --test tests/*.test.js`)
```text
tests/auth.test.js                  (4 / 4 PASSED — scrypt hashing, legacy format, role aliases, password trimming)
tests/device_auth.test.js           (5 / 5 PASSED — canonical HMAC vectors, replay & skew checks)
tests/device_job_completion.test.js (14 / 14 PASSED — ownership, printer inventory isolation, partial completion refunds, fail-closed 503)
tests/failover.test.js              (4 / 4 PASSED)
tests/pricing.test.js               (4 / 4 PASSED)
tests/print_attempt_identity.test.js(7 test blocks covering all 12 regression scenarios against pg-mem PostgreSQL with unique constraints — 7 / 7 PASSED)
tests/refunds.test.js               (3 / 3 PASSED)

Total: 41 Passed | 0 Failed | 0 Skipped (10.33s)
```

### 3. Static Analysis, Schema Validation & Production Build
- **TypeScript Typecheck:** `npx tsc --noEmit` -> **Exit Code 0 (0 Errors)**
- **Pyright (Raspberry Pi Agent):** `npx pyright .` -> **0 Errors, 0 Warnings, 0 Informations**
- **ESLint:** `npx eslint . --quiet` -> **Exit Code 0 (0 Errors)** *(Note: experimental React 19 compiler hook rules configured to `warn` in `eslint.config.mjs` for legacy client components)*
- **Python Bytecode Compilation:** `python -m py_compile *.py` -> **0 Errors across all agent modules**
- **Shell Script Syntax:** `bash -n install.sh configure-printers.sh doctor.sh` -> **0 Errors**
- **Drizzle Schema & Migration Verification:** Applied [`drizzle/0001_print_attempt_identity.sql`](file:///d:/Printbar-production/printbar-product-design-project/drizzle/0001_print_attempt_identity.sql) to Supabase PostgreSQL; `npx drizzle-kit check` -> **Exit Code 0**
- **Next.js Production Build:** `npm run build` (Next.js 16.2.6 Turbopack) -> **Compiled cleanly in 17.8s, TypeScript finished in 16.9s, Exit Code 0**

---

## SECTION D — REMAINING SOFTWARE LIMITATIONS & HARDWARE COMMISSIONING

### Remaining Software / Environment Limitations
1. Physical printer hardware interactions (`lp`, `lpstat`, TCP port 9100, IPP 631 queries, Linux `/sys/class/thermal`, `systemd` unit activation) are verified only via unit mocks and syntax checks on Windows; live execution on Debian/Raspberry Pi OS 64-bit is unverified until commissioning.
2. Live backend HTTP route integration tests in `tests/*.test.js` exercise the PostgreSQL DDL and transaction logic in `pg-mem` rather than booting an external Next.js server against Supabase during CI.
3. Mid-document physical failure inside multi-doc orders still intentionally escalates to `MANUAL_REVIEW` / `refund_pending` rather than attempting partial page-offset resumption.

### On-Site Physical Hardware Commissioning Checklist
To be executed on-site at Sanjay Ghodawat University Food Court:
1. Connect Raspberry Pi 5 and both printers to the local Ethernet switch.
2. Reserve static IPs on the local router:
   - Kyocera ECOSYS PA3500x: `192.168.1.101`
   - Canon MAXIFY GX6170: `192.168.1.102`
3. Execute automated installation: `sudo bash install.sh`.
4. Configure printer queues: `sudo bash configure-printers.sh`.
5. Execute full system validation: `sudo bash doctor.sh`.
6. Confirm `systemctl is-enabled printbar-kiosk.service` only passes after preflight checks turn green, then load 250 sheets of A4 paper into each printer tray and execute live test prints and Cashfree test transactions via the Admin Dashboard.

---

## SECTION E — FINAL VERDICT

> **CODE READY — HARDWARE VALIDATION REQUIRED**
