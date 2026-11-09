# PrintBar Production Readiness & Architecture Specification

## 1. System Overview
PrintBar is a production-grade, self-service university printing kiosk engineered for Sanjay Ghodawat University (SGU), Food Court, Kolhapur. Normal customers require no authentication or registration to upload, customize, pay, and print documents.

## 2. Hardware Installation Baseline
PrintBar operates **exactly one** physical installation:
- **Kiosk ID**: `PB-K01`
- **Kiosk Name**: PrintBar SGU Foodcourt
- **Physical Location**: Sanjay Ghodawat University, Food Court, Kolhapur, Maharashtra
- **Central Controller**: Raspberry Pi 5 (8GB) running Debian Linux & CUPS
- **Primary Monochrome Printer**: Kyocera ECOSYS PA3500x (CUPS Queue: `Kyocera_PA3500x`, Tray Capacity: 250 sheets)
- **Primary Colour & Monochrome Fallback Printer**: Canon MAXIFY GX6170 (CUPS Queue: `Canon_GX6170`, Tray Capacity: 250 sheets)

## 3. Authoritative Operational Data Architecture
The data layer is unified across:
- `orders` (customer checkout lifecycle)
- `print_jobs` (authoritative admin queue & metrics)
- `payments` (reconciled financial transactions)
- `kiosks` & `devices` (`PB-K01`)
- `printers` (`kyocera_pa3500x`, `canon_gx6170`)
- `device_commands` (remote administrative dispatch)

Any customer order creation, payment settlement, progress update, failover, or file shredding automatically synchronizes both models via `syncOrderToPrintJob()` in `src/lib/server/orders.ts`.

## 4. Production Security & Demo Data Hardening
- **Demo Data Purged**: Fictional kiosks (`KSK-001`, `KSK-002`, `KSK-003`) and fictional printers (`PRN-001` through `PRN-005`) are permanently deleted.
- **Zero Mock Generation**: Production startup in `src/lib/seed.ts` enforces the SGU kiosk, two physical printers, authoritative pricing, and admin accounts. Random generator functions (`rng`) and demo seeding are removed.
- **Demo Reset Disabled**: Endpoints `/api/admin/demo` and `/api/demo/reset` return HTTP 403 Forbidden in production.
- **Cryptographic PINs**: 4-digit PINs are stored as HMAC-SHA256 hashes (`pinHash`), preventing plaintext exposure.
- **Hardware Telemetry Only**: Telemetry values displayed on the dashboard are reported directly by the Raspberry Pi agent or marked unsupported/null.

## 5. Document Privacy & Forensic Shredding
- Temporary customer documents uploaded to `/tmp/printbar-uploads` are deleted upon successful printing or job failure.
- On the Raspberry Pi, files downloaded to `raspberry-pi-agent/data/downloads` are forensically overwritten with zeroes before file unlinking (`secure_delete_file`).

## 6. Financial Integrity & Cashfree Gateway
- Cashfree is the sole payment gateway.
- Final pricing is calculated strictly on the backend based on logical sheets, duplex mode, and copies.
- Webhooks verify signatures using `x-webhook-signature` with `CASHFREE_WEBHOOK_SECRET` / `CASHFREE_CLIENT_SECRET`.
- Partial failure refunds calculate exact unprinted sheets, issuing automatic refunds via Cashfree API while preventing duplicate refunds.

