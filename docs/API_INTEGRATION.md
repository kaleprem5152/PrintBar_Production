# PrintBar API & Agent Integration Specification

## 1. Authentication Protocols

### 1.1 Device / Raspberry Pi Agent Authentication
The Raspberry Pi agent authenticates with the cloud backend using either:
1. **HMAC-SHA256 Signature (Recommended)**:
   - Header `x-device-id`: `PB-K01`
   - Header `x-device-ts`: Current Unix epoch seconds (valid within $\pm 60$ seconds)
   - Header `x-device-nonce`: Random UUIDv4 hex string
   - Header `x-device-token`: `HMAC-SHA256("PB-K01:ts:nonce", DEVICE_AUTH_SECRET)`
2. **Shared Secret**:
   - Header `x-agent-key`: Value matching `KIOSK_AGENT_SECRET` or `DEVICE_AUTH_SECRET`

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

