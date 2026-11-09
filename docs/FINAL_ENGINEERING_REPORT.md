# PRINTBAR — MASTER PRODUCTION ENGINEERING REPORT

**Project:** PrintBar Autonomous University Printing Kiosk  
**Target Hardware:** Raspberry Pi 5 (8GB) — PB-K01, SGU Food Court, Sanjay Ghodawat University, Kolhapur  
**Printers:** Kyocera ECOSYS PA3500x (B&W) & Canon MAXIFY GX6170 (Colour & Fallback)  
**Production URL:** `https://printbarproduction-production.up.railway.app`  
**GitHub Repository:** `https://github.com/kaleprem5152/PrintBar_Production`  
**Date:** November 2026  
**Final Status:** `CODE READY — HARDWARE VALIDATION REQUIRED`

---

## SECTION A — SYSTEM ARCHITECTURE OVERVIEW

The PrintBar system comprises three tightly coupled yet fault-tolerant layers:
1. **Cloud Backend & Admin Control Centre (Next.js 16 App Router on Railway & Supabase PostgreSQL)**:
   - Full customer workflow: Document upload, server-side preflight & validation, dynamic pricing engine (₹2/B&W sheet, ₹8/Colour sheet), Cashfree payment integration with webhook HMAC verification, collection PIN issuance.
   - Dedicated Admin Control Centre: Live printer health, real-time telemetry, paper inventory management with +250 refill triggers, remote CUPS maintenance actions, full audit logs.
   - Synchronized Job Pipeline: Dual-path event reconciliation keeping `orders` and `print_jobs` in lockstep.

2. **Raspberry Pi Autonomous Hardware Daemon (`agent.py` v3.0)**:
   - Runs under isolated `printbar` system user in `/opt/printbar/agent` with systemd watchdog.
   - Durable SQLite database (`agent.db`) with Write-Ahead Logging (`WAL`), foreign keys, and durable outbox for offline network resilience.
   - Dual-telemetry heartbeats transmitting Pi 5 thermal readings, memory, and CPU metrics alongside physical printer states.
   - Nonce replay protection and cryptographic HMAC-SHA256 device authentication.

3. **Print Execution & CUPS Subsystem (`cups_manager.py` & `printer_monitor.py`)**:
   - Native IPP Everywhere Ethernet connection (`ipp://<IP>:631/ipp/print`).
   - Dynamic page-range extraction enabling seamless partial failover from Kyocera to Canon without repeating already printed sheets.
   - 3-pass forensic document destruction (`\x00`, `\xff`, `\xa5`) ensuring zero residual student data retention.

---

## SECTION B — REPOSITORY AUDIT & HARDENING ACTIONS

| Component | Initial State | Hardened State |
| :--- | :--- | :--- |
| **Agent DB** | In-memory / basic SQLite, no outbox, risk of data loss | SQLite WAL mode, schema versioning, durable outbox, attempt tracking, nonce deduplication |
| **Printers** | Hardcoded USB URIs, simulation mode fallbacks | LAN IPP Everywhere driverless queues (`printbar-kyocera`, `printbar-canon`), zero simulation |
| **Failover** | Simple queue flip (duplicate pages printed) | Page-range tracking (`page-ranges=N-M`) resuming exact unprinted sheets on Canon |
| **Paper Tracking**| Unenforced paper counts | Strict 250-sheet tray tracking, payment & upload blocking on paper exhaustion, +250 refill controls |
| **Agent Auth** | Static header checks | Cryptographic HMAC-SHA256 signature with epoch timestamp window and durable nonce store |
| **Installer** | Broken `/home/pi` script assuming USB | Production `install.sh`, `doctor.sh`, `configure-printers.sh`, `upgrade.sh`, `uninstall.sh` |
| **Admin UI** | Mock stats & unconnected actions | Completely replaced with real operational dashboard connected to live telemetry & command routes |

---

## SECTION C — VERIFIED TEST RESULTS

### 1. Backend & Next.js Unit / Integration Tests (Node Test Runner)
```
✔ Auth: Password hashing creates valid scrypt dollar format (169ms)
✔ Auth: Legacy colon salt:hash format verification (169ms)
✔ Device Auth: Valid HMAC signature with nonce passes verification (2ms)
✔ Device Auth: Expired timestamp (>60s) is rejected (1ms)
✔ Device Auth: Tampered signature is rejected (0.6ms)
✔ Failover: Mid-print failure at page 4 of 10 routes pages 5-10 to backup Canon (0.6ms)
✔ Failover: Failure on initial page 0 routes entire document 1-15 (0.1ms)
✔ Failover: Failure on penultimate page routes only single remaining page (0.09ms)
✔ Failover: Already completed job requires no failover (0.07ms)
✔ Pricing: Single-sided B&W calculation at SGU standard rate (₹2) (1ms)
✔ Pricing: Double-sided (duplex) B&W calculation (0.19ms)
✔ Pricing: Colour single-sided calculation at SGU standard rate (₹8) (0.15ms)
✔ Pricing: Colour double-sided with multi-copies (0.16ms)
✔ Refunds: Total print failure receives 100% full refund (0.7ms)
✔ Refunds: Full completion results in zero refund (0.14ms)
✔ Refunds: Partial failure at 10 of 20 sheets refunds exactly unprinted balance (0.12ms)

Pass: 16 | Fail: 0 (100% PASS)
```

### 2. Python Agent Test Suite (Pytest)
```
tests/test_agent.py (5/5 PASSED)
tests/test_auth.py (6/6 PASSED)
tests/test_config.py (6/6 PASSED)
tests/test_cups_manager.py (6/6 PASSED)
tests/test_db.py (13/13 PASSED)
tests/test_printer_monitor.py (4/4 PASSED)

Pass: 40 | Fail: 0 (100% PASS)
```

### 3. Static Type Analysis & Production Compilation
- **TypeScript:** `npx tsc --noEmit` -> **0 Errors**
- **Next.js Production Build:** `npm run build` -> **Exit code 0**, 48+ static & dynamic routes compiled
- **Python Compilation:** `python -m py_compile` -> **All 6 agent modules compile with 0 errors**

---

## SECTION D — COMMISSIONING & DEPLOYMENT CHECKLIST

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
> All software implementations, automated installers, security authentications, failure recovery pipelines, database schemas, and unit test suites are fully completed, tested, and validated in code. Final commissioning requires running `doctor.sh` and executing the physical test prints on the live hardware at SGU Food Court.
