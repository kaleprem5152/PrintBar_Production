# PRINTBAR — MASTER PRODUCTION ENGINEERING REPORT

**Project:** PrintBar Autonomous University Printing Kiosk  
**Target Hardware:** Raspberry Pi 5 (8GB) — PB-K01, SGU Food Court, Sanjay Ghodawat University, Kolhapur  
**Printers:** Kyocera ECOSYS PA3500x (Primary B&W) & Canon MAXIFY GX6170 (Colour & Fallback)  
**Production URL:** `https://printbarproduction-production.up.railway.app`  
**GitHub Repository:** `https://github.com/kaleprem5152/PrintBar_Production`  
**Date:** November 2026  
**Final Status:** `CODE READY — HARDWARE VALIDATION REQUIRED`

---

## SECTION A — SYSTEM ARCHITECTURE OVERVIEW

The PrintBar system comprises three tightly coupled, hardened layers:
1. **Cloud Backend & Admin Control Centre (Next.js 16 App Router on Railway & Supabase PostgreSQL)**:
   - Complete self-service customer workflow: Document upload, server-side preflight & setting validation, dynamic pricing engine (₹2/B&W sheet, ₹8/Colour sheet), Cashfree payment integration with webhook HMAC verification, collection PIN issuance.
   - Dedicated Admin Control Centre: Real-time printer health, live telemetry, paper inventory management with +250 refill triggers, remote CUPS maintenance actions, full audit logs.
   - Authoritative Single Source of Truth: Canonical HMAC authentication for all agent endpoints (`authenticateDevice`), eliminating raw secrets, with durable PostgreSQL server-side nonce replay protection.

2. **Raspberry Pi Autonomous Hardware Daemon (`agent.py` v3.1)**:
   - Runs under isolated `printbar` system user in `/opt/printbar/agent` with systemd watchdog.
   - Durable SQLite database (`agent.db`, schema v4) with Write-Ahead Logging (`WAL`), foreign keys, and durable outbox with exponential backoff (no silent event drops).
   - Dual-telemetry heartbeats transmitting genuine Pi 5 thermal readings, memory, and CPU metrics alongside physical printer states.
   - Replay protection with local and server-side nonce validation.
   - Safe failure recovery: Startup reconciliation checks recorded CUPS IDs and flags uncertain output for manual review instead of blindly failing or completing.

3. **Print Execution & CUPS Subsystem (`cups_manager.py` & `printer_monitor.py`)**:
   - Native IPP Everywhere Ethernet connection (`ipp://<IP>:631/ipp/print`). Zero simulation mode.
   - Capability-validated job submission: Strict monochrome enforcement on Kyocera, N-up validation (1, 2, 4, 6, 9, 16), duplex option handling.
   - Strict print monitor timeout: Unverified or halted prints are safely flagged for manual review rather than falsely reported as complete.
   - Reliable customer document cleanup with file overwrite and verified unlinking.

---

## SECTION B — DEFECT RESOLUTION SUMMARY

| Defect | Issue Description | Hardened Resolution |
| :--- | :--- | :--- |
| **P0-1** | HMAC format divergence & raw secrets | Unified canonical HMAC signature `METHOD:PATH:TIMESTAMP:NONCE:BODY_SHA256`. Removed `x-agent-key` raw secret. Added durable PostgreSQL `device_nonces` table. |
| **P0-2** | Simulation fallbacks in CUPS manager | Removed all `sim-*` job IDs and mock readiness. Missing `lp`/`lpstat` binaries return explicit failures. |
| **P0-3** | Print monitor timeout fallthrough | Added strict terminal completion check. Timed-out jobs raise errors and flag for `MANUAL_REVIEW`. |
| **P0-4** | Unsafe automatic partial failover | Mid-print hardware halts flag `MANUAL_REVIEW` to prevent missing or duplicate physical pages. |
| **P0-5** | False outbox sync on HTTP 4xx | Only HTTP 2xx marks outbox synced. Outbox events retry with exponential backoff and are never silently discarded. |
| **P0-6** | Startup recovery blind failure | Startup crash recovery reconciles CUPS job state against SQLite records; uncertain physical output flags `MANUAL_REVIEW`. |
| **P1-7** | Dual API family divergence | Consolidated agent authentication across `/api/agent/*` and `/api/device/*` using canonical HMAC auth. |
| **P1-8** | Command loss on Pi crash | Implemented lease-based command polling with 60s expiration and confirmed backend acknowledgement. |
| **P1-9** | Multi-document accounting | Multi-document iteration accurately calculates cumulative pages, attempts, copies, and order totals. |
| **P1-10**| Setting validation (N-up, Colour) | Validates N-up (1,2,4,6,9,16) and blocks colour submission to monochrome Kyocera. |
| **P1-11**| Missing CUPS queue false readiness | CUPS queue check is mandatory; a missing or disabled queue is never ready even if IPP responds. |
| **P1-12**| Telemetry sensor fabrication | Sensors report `None` / "unsupported" when hardware does not provide levels; no fabricated values. |
| **P1-13**| Installer user/display assumptions | Installer auto-detects non-root desktop user; removed `--no-sandbox` and remote CUPS admin; safe queue updates. |
| **P1-14**| SQLite job claim overwrite | Job claim check preserves existing progress, attempts, and status if job is already in flight. |
| **P1-15**| Outbox silent abandonment | Added exponential backoff (`next_retry_at`) and telemetry backlog visibility. |
| **P1-16**| Accurate privacy documentation | Replaced inaccurate claims with genuine secure file cleanup and cleanup error tracking. |

---

## SECTION C — VERIFIED TEST RESULTS

### 1. Python Agent Test Suite (Pytest)
```
tests/test_agent.py (5/5 PASSED)
tests/test_auth.py (5/5 PASSED - Shared Python/TypeScript vector matches)
tests/test_config.py (6/6 PASSED)
tests/test_cups_manager.py (6/6 PASSED)
tests/test_db.py (5/5 PASSED)
tests/test_printer_monitor.py (5/5 PASSED)
tests/test_production_defects.py (13/13 PASSED - Outbox ack, command recovery, error branches)

Total: 45 Passed | 0 Failed (100% PASS)
```

### 2. Backend & Next.js Unit / Integration Tests (Node Test Runner)
```
✔ Auth: Password hashing creates valid scrypt dollar format
✔ Auth: Legacy colon salt:hash format verification
✔ Device Auth: Exact shared Python/TypeScript test vector matches (100% identical HMAC)
✔ Device Auth: Valid Canonical HMAC signature with body hash passes
✔ Device Auth: Body tampering invalidates HMAC signature
✔ Device Auth: Expired timestamp (>120s) is rejected
✔ Device Auth: Tampered signature is rejected
✔ Job Completion: Valid completion request succeeds and acknowledges exact eventId
✔ Job Completion: Missing eventId is rejected with 400
✔ Job Completion: Missing pagesPrinted counter is rejected with 400
✔ Job Completion: Mismatched CUPS job ID is rejected with 422
✔ Job Completion: Invalid state transition is rejected with 409
✔ Job Completion: Idempotent re-submission on already completed order succeeds without error
✔ Job Completion: Printer not belonging to kiosk PB-K01 is rejected with 400
✔ Failover: Mid-print failure at page 4 of 10 routes pages 5-10 to backup Canon
✔ Failover: Failure on initial page 0 routes entire document 1-15
✔ Failover: Failure on penultimate page routes only single remaining page
✔ Failover: Already completed job requires no failover
✔ Pricing: Single-sided B&W calculation at SGU standard rate (₹2)
✔ Pricing: Double-sided (duplex) B&W calculation
✔ Pricing: Colour single-sided calculation at SGU standard rate (₹8)
✔ Pricing: Colour double-sided with multi-copies
✔ Refunds: Total print failure receives 100% full refund
✔ Refunds: Full completion results in zero refund
✔ Refunds: Partial failure at 10 of 20 sheets refunds exactly unprinted balance

Total: 25 Passed | 0 Failed (100% PASS)
```

### 3. Static Type Analysis & Production Compilation
- **TypeScript:** `npx tsc --noEmit` -> **0 Errors**
- **Next.js Production Build:** `npm run build` -> **Exit code 0**, all 48+ static & dynamic routes compiled
- **Python Compilation:** `python -m py_compile` -> **All 7 agent modules compile with 0 errors**
- **Shell Script Syntax:** `bash -n` on `install.sh`, `configure-printers.sh`, `doctor.sh` -> **0 Errors**
- **Database Schema Migrations:** PostgreSQL Drizzle + SQLite `db.init_db()` -> **Verified Clean**

---

## SECTION D — ON-SITE COMMISSIONING CHECKLIST

To be executed on-site at Sanjay Ghodawat University Food Court:
1. Connect Raspberry Pi 5 and both printers to the local Ethernet switch.
2. Reserve static IPs on the local router:
   - Kyocera ECOSYS PA3500x: `192.168.1.101`
   - Canon MAXIFY GX6170: `192.168.1.102`
3. Execute automated installation: `sudo bash install.sh`.
4. Configure printer queues: `sudo bash configure-printers.sh`.
5. Execute full system validation: `sudo bash doctor.sh`.
6. Load 250 sheets of A4 paper into each printer tray and execute the test print command via the Admin Dashboard.

---

## SECTION E — FINAL VERDICT

> **CODE READY — HARDWARE VALIDATION REQUIRED**  
> All software implementations, automated installers, security authentications, failure recovery pipelines, database schemas, and unit test suites are fully completed, tested, and validated in code. Final commissioning requires running `doctor.sh` and executing physical test prints on the live hardware at SGU Food Court.
