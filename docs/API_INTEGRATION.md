# PrintBar API & Agent Integration Specification

## 1. Authentication Protocols

### 1.1 Device / Raspberry Pi Agent Authentication (Canonical V4 Contract)
The Raspberry Pi agent authenticates with all `/api/device/*` and `/api/agent/*` cloud backend endpoints using the unified canonical HMAC-SHA256 protocol:

- **Canonical String Format**:
  `METHOD:PATH:TIMESTAMP:NONCE:BODY_SHA256`
  - `METHOD`: Uppercase HTTP verb (e.g., `GET`, `POST`, `PATCH`)
  - `PATH`: Normalized path without query parameters or trailing slashes (e.g., `/api/device/jobs/PB-2026-00003`)
  - `TIMESTAMP`: Unix epoch seconds as string (clock skew allowed: $\pm 120$ seconds)
  - `NONCE`: Unique UUIDv4 hex string (persisted in PostgreSQL `device_nonces` table to prevent replay attacks)
  - `BODY_SHA256`: Hexadecimal SHA-256 hash of the exact request body bytes (empty body uses SHA-256 of empty bytes: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`)

- **Required Headers**:
  - `X-Device-ID`: Device identifier (`PB-K01`)
  - `X-Timestamp`: Unix epoch timestamp string
  - `X-Nonce`: UUIDv4 string
  - `X-Signature`: `HMAC-SHA256(canonical_message, DEVICE_AUTH_SECRET)`

- **Security Hardening**:
  - Raw secret headers (`x-agent-key`) are strictly forbidden and rejected.
  - Server-side nonce validation is atomic and durable across backend instances. Nonces are recorded only after signature passes.
  - Replayed nonces or clock skew $>120$ seconds are immediately rejected with HTTP 401.

### 1.2 Admin Dashboard Authentication
- Endpoint: `POST /api/auth/login`
- Accepts email (`admin@printbar.in`) or username (`admin`, `super`, `ops`, `finance`, `maintenance`)
- Supported hash formats: `scrypt$salt$hash` and legacy `salt:hash`
- Session cookie: `pb_admin_token` (HTTP-only, Secure)

---

## 2. Core Operational Endpoints

### 2.1 Polling & Claiming Jobs
- `GET /api/device/jobs`: Lists paid orders waiting to be claimed by kiosk controller `PB-K01`.
- `POST /api/device/jobs`: Atomically claims a job (`{ "orderId": "PB-2026-00003" }`), assigning `queued` status and returning job settings and document metadata.
- `GET /api/device/jobs/[orderId]/files/[docId]`: Streams document bytes to the agent for local spooling.

### 2.2 Progress Reporting & Completion
- `PATCH /api/device/jobs/[orderId]`:
  - Body: `{ "pagesPrinted": 5, "cupsJobId": "Kyocera_PA3500x-105", "status": "printing" }`
  - Updates page counter and synchronizes `print_jobs` in real-time.
- `POST /api/device/jobs/[orderId]?action=complete`:
  - Body: `{ "pagesPrinted": 10, "cupsJobId": "Kyocera_PA3500x-105" }`
  - Deducts physical paper sheets, deletes temporary cloud files, clears PIN, and records completion.

### 2.3 Partial Failure & Failover
- `POST /api/device/jobs/[orderId]?action=fallback`:
  - Body: `{ "pagesPrinted": 4, "reason": "kyocera_paper_jam", "previousCupsJobId": "Kyocera_PA3500x-105" }`
  - Updates baseline to 4 pages and routes unprinted pages 5-10 to Canon GX6170.
- `POST /api/device/jobs/[orderId]?action=fail`:
  - Body: `{ "pagesPrinted": 3, "reason": "Hardware fatal error", "cupsJobId": "..." }`
  - Computes exact unprinted balance and initiates automatic Cashfree refund.

### 2.4 Administrative Commands & Heartbeat
- `POST /api/agent/heartbeat`: Receives real hardware telemetry (CPU temp, CPU%, RAM%, disk%, CUPS printer status).
- `GET /api/agent/commands?kioskId=PB-K01`: Polls pending commands issued from the Admin Control Centre.
- `POST /api/agent/commands/[id]`: Acknowledges command execution status (`succeeded` / `failed`) with execution output.

