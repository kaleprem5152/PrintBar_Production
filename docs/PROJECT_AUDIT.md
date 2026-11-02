# PrintBar — Phase 0 Source Code Audit

**Audit date:** 2026-11-02  
**Auditor:** Antigravity (Principal Software Architect role)  
**Git baseline commit:** `da4dd04` (branch: `master`)  
**Recovery:** `git checkout da4dd04` restores the pre-implementation state at any time.

---

## 1. Repository Structure Overview

```
printbar-product-design-project/
├── drizzle.config.json          — Drizzle ORM config (hardcoded local DB URL)
├── eslint.config.mjs
├── next.config.ts               — Minimal Next.js config
├── package.json
├── postcss.config.mjs
├── public/
│   └── pdf.worker.min.mjs       — PDF.js worker (1.2 MB, vendored)
└── src/
    ├── app/
    │   ├── globals.css          — Complete design system: tokens, animations, keyframes
    │   ├── layout.tsx           — Root layout (Geist + Instrument Serif fonts)
    │   ├── page.tsx             — Marketing landing page
    │   ├── api/
    │   │   ├── config/          — GET: returns pricing + hardware config
    │   │   ├── demo/reset/      — POST: resets demo order (dev helper)
    │   │   ├── health/          — GET: DB connectivity check
    │   │   ├── kiosk/
    │   │   │   ├── jobs/[orderId]/  — GET: poll job; POST: start/resume job
    │   │   │   ├── status/          — GET: kiosk state; POST: set state (prototype)
    │   │   │   └── verify-pin/      — POST: PIN lookup with rate limiting
    │   │   ├── kiosks/          — GET: list all kiosk records
    │   │   ├── orders/
    │   │   │   ├── route.ts     — POST: create order from uploaded docs
    │   │   │   └── [orderId]/   — GET: fetch order (token-authenticated)
    │   │   ├── payments/
    │   │   │   ├── prototype/   — POST: FAKE payment gateway simulator
    │   │   │   └── verify/      — POST: payment verification (HMAC prototype)
    │   │   └── upload/
    │   │       ├── route.ts     — POST: file upload + validation
    │   │       └── [id]/        — DELETE: remove uploaded file
    │   ├── demo/page.tsx        — Demo reset page
    │   ├── kiosk/
    │   │   ├── page.tsx         — Kiosk touchscreen app
    │   │   └── gallery/         — Screen gallery/showcase
    │   ├── print/page.tsx       — Customer print workspace
    │   └── track/[orderId]/     — Order tracking page (shows PIN)
    ├── components/
    │   ├── kiosk/               — 5 files: FitStage, KioskApp, Machine, screens, types
    │   ├── print/               — 6 files: DocPreview, OrderView, PaymentSheet, Settings, Workspace, types
    │   ├── site/                — 5 files: DemoClient, HeroScene, KioskFinder, Sections, SiteHeader
    │   ├── three/               — 2 files: KioskScene (3D), textures
    │   └── ui/                  — 1 file: Icon.tsx
    ├── db/
    │   ├── index.ts             — pg Pool + Drizzle connection
    │   └── schema.ts            — orders + kiosks tables
    └── lib/
        ├── config.ts            — Shared constants (pricing, hardware, KIOSK_ID, etc.)
        ├── pricing.ts           — parsePageRange, buildQuote, expandRange
        └── server/
            ├── files.ts         — Temp file storage, page counting, sweep
            └── orders.ts        — Order CRUD, PIN generation, advance() simulator, toPublic
```

---

## 2. Dependency Inventory

| Package | Version | Purpose |
|---|---|---|
| next | 16.2.6 | Framework |
| react | 19.2.6 | UI runtime |
| drizzle-orm | 0.45.2 | ORM |
| pg | 8.20.0 | PostgreSQL driver |
| pdfjs-dist | ^6.5.438 | PDF preview |
| @react-three/fiber | ^9.8.2 | 3D renderer |
| three | ^0.187.0 | 3D engine |
| jszip | ^3.10.2 | DOCX page count |
| qrcode | ^1.5.4 | QR code generation |
| tailwindcss | 4.1.17 | Styling |

**Missing for production:**
- `cashfree-pg` or Cashfree HTTP client — NOT PRESENT
- Admin authentication library — NOT PRESENT  
- Rate-limiting middleware — NOT PRESENT (only in-memory array in verify-pin)
- Cashfree webhook signature verification — NOT PRESENT

---

## 3. Feature Assessment

### 3.1 What Is Genuinely Working

| Feature | Status | Notes |
|---|---|---|
| File upload (PDF/DOC/DOCX/JPG/PNG) | WORKING | Extension + magic-byte + MIME + size validation |
| PDF page counting | WORKING | Regex on raw buffer; may estimate for complex PDFs |
| DOCX page counting | WORKING | Reads docProps/app.xml via JSZip |
| DOC page estimation | WORKING | File-size estimate (flagged as estimated) |
| Image upload (JPG/PNG) | WORKING | Treated as 1 page |
| Temp file storage + cleanup | WORKING | os.tmpdir()/printbar-uploads/, 24h sweep |
| File deletion on completion | WORKING | deleteStoredFiles() called after virtual print |
| Order creation with server-side pricing | WORKING | Client page count ignored; server readMeta() used |
| Page range parsing | WORKING | Handles "1-5, 8, 11-13"; validates bounds |
| Price calculation | WORKING | Rs2/page BW, Rs8/page colour, server-authoritative |
| Order token security | WORKING | Random 12-byte hex token required to read order |
| Kiosk PIN entry (6-screen UX) | WORKING | Idle > PIN > Retrieved > Printing > Completed/Error |
| PIN brute-force protection | PARTIAL | In-memory sliding window only (lost on restart) |
| PIN expiry | WORKING | 24-hour TTL, expiresAt enforced at query time |
| Kiosk inactivity timeout | WORKING | 60s inactivity returns to Idle |
| PDF.js document preview | WORKING | Canvas rendering with page nav and zoom |
| Printer status UI | WORKING | Shows ready/paper_out/paper_jam/offline/error |
| QR code on kiosk idle screen | WORKING | Points to /print URL |
| 3D kiosk landing page visualisation | WORKING | React Three Fiber with procedural textures |
| Order tracking + PIN reveal | WORKING | Animated digit-by-digit reveal, polling, live tracker |
| Multi-file upload (up to 5) | WORKING | Slots enforced client and server |
| XHR upload with progress bar | WORKING | Per-file progress reporting |

### 3.2 What Is Prototype / Simulated

| Feature | Prototype Status | What Replaces It |
|---|---|---|
| Payment gateway | FAKE — prototype endpoint simulates Razorpay | Cashfree real SDK + hosted checkout |
| Payment verification | PROTOTYPE — HMAC with wrong gateway | Cashfree webhook signature verification |
| Printer engine | SIMULATED — advance() uses PAGE_MS=600ms timer | Real CUPS via Raspberry Pi agent |
| Kiosk status | SIMULATED — POST /api/kiosk/status is dev toggle | Real CUPS status from Pi agent |
| Print job start | SIMULATED — Sets printStartedAt + timer | Real job dispatch to Raspberry Pi |
| Dual-printer routing | NOT PRESENT — single virtual printer | Kyocera (BW) + Canon (colour/fallback) |
| Raspberry Pi agent | NOT PRESENT | Python agent: auth, heartbeat, CUPS |
| Admin dashboard | NOT PRESENT | Revenue, history, printer management |
| Device authentication | NOT PRESENT | Pi authenticates to cloud APIs |
| Cashfree webhook | NOT PRESENT | POST /api/payments/webhook |
| signPayment() | WRONG KEY — uses RAZORPAY_KEY_SECRET | Cashfree signature algorithm |
| advance() function | DELETE IN PRODUCTION | Replaced by real Pi status reporting |
| ensureSeed() | DEV ONLY — seeds demo + fake kiosks | Production must not auto-seed |

### 3.3 What Is Missing Entirely

- Cashfree payment integration (P0 CRITICAL)
- Cashfree webhook endpoint + signature verification (P0 CRITICAL)
- Raspberry Pi Python hardware agent (P0 CRITICAL)
- CUPS-based print submission (P0 CRITICAL)
- Dual-printer routing (Kyocera/Canon) (P0 CRITICAL)
- Printer failover logic (P0 CRITICAL)
- Admin authentication system (P1 HIGH)
- Admin dashboard (P1 HIGH)
- Device (Pi) authentication API (P0 CRITICAL)
- Device heartbeat API (P1 HIGH)
- Job claiming API (atomic, no duplicate jobs) (P0 CRITICAL)
- Job file download API for Pi (P0 CRITICAL)
- Job progress reporting from Pi (P0 CRITICAL)
- Document deletion confirmation from Pi (P0 CRITICAL)
- Real printer status from CUPS (P0 CRITICAL)
- Production database schema (expanded) (P0 CRITICAL)
- .env.example with all required variables (P0 CRITICAL)
- Railway deployment config (P1 HIGH)
- systemd service files (P1 HIGH)
- Raspberry Pi setup script (P1 HIGH)
- Chromium kiosk autostart (P1 HIGH)
- Rate limiting middleware (P1 HIGH)
- Secure HTTP headers (P1 HIGH)
- Meaningful test suite (P1 HIGH)

---

## 4. Security Problems Identified

| Issue | Severity | Location |
|---|---|---|
| Payment verification uses Razorpay HMAC (wrong gateway) | CRITICAL | src/lib/server/orders.ts:102 |
| Prototype payment endpoint — processes no real money | CRITICAL | src/app/api/payments/prototype/route.ts |
| Kiosk status can be set by anyone (no auth) | HIGH | POST /api/kiosk/status |
| PIN rate limiting is in-memory only | HIGH | src/app/api/kiosk/verify-pin/route.ts:9-11 |
| drizzle.config.json hardcodes a local Postgres URL | MEDIUM | drizzle.config.json:5 |
| RAZORPAY_KEY_SECRET env var referenced (wrong gateway) | MEDIUM | src/lib/server/orders.ts:102 |
| No Content Security Policy headers | MEDIUM | Missing globally |
| No CSRF protection on any endpoint | MEDIUM | Missing globally |
| File uploads in os.tmpdir() — shared system directory | LOW | src/lib/server/files.ts:9 |
| Predictable order IDs (142 + db_id) | LOW | src/lib/server/orders.ts:128 |

---

## 5. Database Schema Assessment

### Existing `orders` table — good foundation, needs extension

Columns to keep: id, orderId, token, pin, status, docs, pagesPerCopy, copies, colorMode, paperSize, sides, orientation, amount, pagesToPrint, pagesPrinted, printBaseline, printStartedAt, failureReason, paymentRef (rename), filesDeleted, isDemo, expiresAt, paidAt, completedAt, createdAt

Columns to add: cashfreeOrderId, cashfreePaymentId, printerUsed, cupsJobId, deviceId, fallbackPrinter, fallbackAt

### Tables to add

- payment_transactions — full Cashfree transaction records
- print_jobs — per-job record linking order + printer + CUPS job ID
- print_attempts — each print attempt (original + fallback)
- printer_status_history — time series of CUPS status reports
- admin_users — hashed credentials
- audit_events — security-relevant actions log
- pricing_config — DB-driven pricing
- device_credentials — Raspberry Pi device auth tokens

---

## 6. Frontend Preservation Confirmation

All frontend components are preserved. The PaymentSheet.tsx interior logic will be replaced with Cashfree checkout while preserving all visual UI elements, loading states, and error handling screens.

---

## 7. Implementation Phases

| Phase | Status |
|---|---|
| Phase 0 — Source Audit | COMPLETE |
| Phase 1 — Architecture and Database | IN PROGRESS |
| Phase 2 — Document Engine | PENDING |
| Phase 3 — Cashfree Integration | PENDING |
| Phase 4 — Raspberry Pi Agent | PENDING |
| Phase 5 — CUPS and Dual Printers | PENDING |
| Phase 6 — Full Integration | PENDING |
| Phase 7 — Admin Dashboard | PENDING |
| Phase 8 — Deployment and Hardening | PENDING |
