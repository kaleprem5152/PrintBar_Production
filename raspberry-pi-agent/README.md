# PrintBar Raspberry Pi Agent (PB-K01)

Autonomous hardware control daemon for the PrintBar Self-Service Kiosk at SGU Food Court, Sanjay Ghodawat University, Kolhapur.

## Overview

The agent runs as a background systemd service on a Raspberry Pi 5 (8GB) connected to:
- **Kyocera ECOSYS PA3500x**: Primary B&W high-volume network printer (Queue: `printbar-kyocera`).
- **Canon MAXIFY GX6170**: Colour network printer & automatic B&W fallback (Queue: `printbar-canon`).
- **Campus LAN Switch**: Connects Pi, both printers, and provides internet uplink.

## Features

1. **Autonomous Daemon (`agent.py`)**:
   - Zero-configuration startup validation in `PRODUCTION_MODE=true`.
   - Real-time hardware telemetry (`psutil` CPU %, RAM %, Thermal Zone °C, Disk %).
   - Dual-telemetry heartbeats (`/api/device/heartbeat` and `/api/agent/heartbeat`).
   - Remote command execution via Admin Control Centre (test prints, queue clearing, paper refills, service restarts).
   - Atomic job claiming with idempotency keys.
   - Capability-validated pre-flight routing between Kyocera PA3500x and Canon GX6170. Mid-print interruptions are safely flagged for manual review to prevent duplicate printing.
   - Secure customer document cleanup with file overwrite and reliable unlinking.
   - Paper inventory enforcement (250-sheet trays per printer).

2. **Unified Printer Monitoring (`printer_monitor.py`)**:
   - Direct IPP (RFC 8011) attribute queries over HTTP/socket without heavy external libraries.
   - CUPS queue states via `lpstat` and native bindings.
   - TCP port 631 & 9100 reachability checks.
   - 10 distinct hardware states: `READY`, `PRINTING`, `WARNING`, `PAPER_OUT`, `PAPER_JAM`, `COVER_OPEN`, `OFFLINE`, `DISABLED`, `ERROR`, `UNKNOWN`.

3. **Durable Local Database (`db.py`)**:
   - SQLite with Write-Ahead Logging (`WAL` mode) and 5000ms busy timeout.
   - Foreign key constraints enabled.
   - Outbox pattern for queueing cloud updates during intermittent campus network drops.
   - Nonce replay protection with periodic TTL pruning.
   - Comprehensive print attempt history and execution auditing.

## Installation on Raspberry Pi 5

Run the automated production installer on a clean Raspberry Pi OS 64-bit installation:

```bash
sudo bash install.sh
```

The installer will:
1. Install system packages (`cups`, `python3-venv`, `libcups2-dev`, `chromium-browser`, etc.).
2. Create dedicated `printbar` system user and group.
3. Set up the virtual environment in `/opt/printbar/venv`.
4. Deploy code to `/opt/printbar/agent/`.
5. Create configuration template at `/etc/printbar/printbar.env`.
6. Configure sudoers permissions in `/etc/sudoers.d/printbar`.
7. Install and enable systemd units (`printbar-agent.service` and `printbar-kiosk.service`).

## Network Printer Setup

Run the interactive printer configuration wizard:

```bash
sudo bash configure-printers.sh
```
Input the reserved static IPs for the Kyocera PA3500x and Canon GX6170. The wizard configures driverless IPP Everywhere queues:
- `printbar-kyocera` -> `ipp://<KYOCERA_IP>:631/ipp/print`
- `printbar-canon` -> `ipp://<CANON_IP>:631/ipp/print`

## Diagnostics & Verification

Run the comprehensive system diagnostic tool:

```bash
sudo bash doctor.sh
```

Checks:
- [x] Raspberry Pi Hardware & Thermal State
- [x] Internet & Cloud API Connectivity
- [x] Ethernet reachability for both printer IPs (Ports 631 and 9100)
- [x] CUPS Daemon & Queue Readiness
- [x] Agent Python Environment & Code Compilation
- [x] Security Configuration & Nonce Storage
- [x] Kiosk Display Browser Daemon

## Upgrades & Maintenance

To deploy an updated agent version without disrupting production credentials:

```bash
sudo bash upgrade.sh
```

To view live service logs:

```bash
sudo journalctl -u printbar-agent -f
```

