# PrintBar — Self-Service Cloud-to-Hardware Printing ATM

[![Next.js 16](https://img.shields.io/badge/Next.js-16.2-black?style=flat&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?style=flat&logo=typescript)](https://www.typescriptlang.org/)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle-PostgreSQL-orange?style=flat)](https://orm.drizzle.team/)
[![Supabase](https://img.shields.io/badge/Supabase-Database-emerald?style=flat&logo=supabase)](https://supabase.com/)
[![Cashfree](https://img.shields.io/badge/Cashfree-Production%20PG-violet?style=flat)](https://www.cashfree.com/)
[![Raspberry Pi](https://img.shields.io/badge/Raspberry%20Pi-CUPS%20Kiosk-red?style=flat&logo=raspberry-pi)](https://www.raspberrypi.com/)

**PrintBar** is an end-to-end self-service physical printing kiosk system. Users upload documents via their smartphone or desktop, customize print settings (color, copies, simplex/duplex, orientation), pay securely through the Cashfree payment gateway (UPI, QR, Cards, NetBanking), and receive a **4-digit Collection PIN**. They then walk up to any physical PrintBar kiosk, enter their PIN on the touchscreen, and their documents are autonomously printed via dual enterprise printers (Kyocera monochrome laser and Canon color inkjet).

---

## 🏛 Architecture Overview

```
 ┌─────────────────────────────────────────────────────────┐
 │                   CUSTOMER SMARTPHONE                   │
 │   Upload Doc ──► Preview ──► Cashfree PG ──► 4-Digit PIN │
 └────────────────────────────┬────────────────────────────┘
                              │ HTTPS
                              ▼
 ┌─────────────────────────────────────────────────────────┐
 │                  NEXT.JS 16 CLOUD APP                   │
 │   - Document Processing (PDF/DOCX/Images)               │
 │   - Server-side Dynamic Pricing Engine                  │
 │   - Cashfree Production Payment Gateway & Webhooks      │
 │   - Kiosk PIN Redemption API with HMAC Device Auth      │
 │   - Supabase PostgreSQL / Drizzle ORM Storage           │
 │   - Real-time Hardware Telemetry & Admin Console        │
 └─────────────┬─────────────────────────────▲─────────────┘
               │ Polling & Job Claim         │ Heartbeats & Status
               ▼                             │
 ┌─────────────────────────────────────────────────────────┐
 │             PHYSICAL RASPBERRY PI KIOSK                 │
 │                                                         │
 │  ┌─────────────────────────┐   ┌─────────────────────┐  │
 │  │ Fullscreen Touch Kiosk  │   │ Python Agent Daemon │  │
 │  │ Chromium --kiosk UI     │   │ - CUPS Printer Mgr  │  │
 │  │ PIN Entry & Preview     │   │ - Secure Download   │  │
 │  └─────────────────────────┘   │ - Page Progression  │  │
 │                                └──────────┬──────────┘  │
 │                                           │             │
 │                     ┌─────────────────────┴──────────┐  │
 │                     ▼                                ▼  │
 │          [Kyocera PA3500x Laser]           [Canon GX6170 Color] │
 └─────────────────────────────────────────────────────────┘
```

---

## 📦 Directory Structure

- `src/` — Next.js 16 App Router application:
  - `src/app/` — Customer web app (`/`, `/print`, `/track/[orderId]`), Touchscreen Kiosk UI (`/kiosk`), Admin Console (`/admin`, `/admin/login`), and Cloud API endpoints (`/api/...`).
  - `src/components/` — Mobile-responsive UI components, 3D Kiosk preview, and payment sheet.
  - `src/db/` — Drizzle ORM database schema, migrations, and PostgreSQL connection pooler.
  - `src/lib/` — Cashfree payments client, HMAC authentication, document parser, and server actions.
- `drizzle/` — Production PostgreSQL SQL migrations applied to Supabase.
- `raspberry-pi-agent/` — Autonomous Python daemon running on Raspberry Pi:
  - `agent.py` — Background job polling, atomic job claiming, and heartbeat manager.
  - `cups_manager.py` — Physical CUPS printer monitoring and print command execution.
  - `auth.py` — HMAC-SHA256 signature generator for hardware authentication.
  - `printbar-agent.service` — Systemd service unit for the Python print daemon.
  - `printbar-kiosk.service` — Systemd service unit for Chromium touch kiosk UI.
  - `setup.sh` — Automated one-line installer for Raspberry Pi OS.
- `Dockerfile` & `railway.json` — Production container build recipes.

---

## 🚀 Part 1: Cloud Web Application Deployment

### Option A: Deploy to Railway (Recommended)

1. Fork or push this repository to GitHub.
2. Sign in to [Railway.app](https://railway.app/).
3. Click **New Project** > **Deploy from GitHub repo** > select `PrintBar_Production`.
4. Railway will automatically detect `railway.json` and build the container using the multi-stage `Dockerfile`.
5. Under **Variables** in the Railway dashboard, set all environment variables listed below.
6. Under **Settings** > **Networking**, generate a public Railway domain (e.g. `https://printbar-production.up.railway.app`).
7. Update `APP_BASE_URL` in Railway variables with your live HTTPS domain.

### Option B: Deploy to Vercel

1. Import the repository on [Vercel](https://vercel.com/new).
2. Framework Preset: **Next.js**.
3. Add all environment variables listed below.
4. Deploy.

---

## 🔑 Environment Variables Reference

Configure these in your production host (Railway / Vercel / Docker `.env`):

| Variable | Description | Example / Production Value |
|---|---|---|
| `NODE_ENV` | Environment mode | `production` |
| `APP_BASE_URL` | Public HTTPS domain of deployed app | `https://your-domain.railway.app` |
| `DATABASE_URL` | Supabase / PostgreSQL connection pooler URL | `postgresql://postgres.[ref]:[pass]@[host]:6543/postgres?pgbouncer=true` |
| `SUPABASE_URL` | Supabase Project URL | `https://[ref].supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase public anon key | `eyJhbGci...` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only) | `eyJhbGci...` |
| `CASHFREE_CLIENT_ID` | Cashfree Production Merchant App ID | `13782403bf98...` |
| `CASHFREE_CLIENT_SECRET` | Cashfree Production Client Secret | `cfsk_ma_prod_...` |
| `CASHFREE_ENV` | Gateway mode (`production` or `sandbox`) | `production` |
| `CASHFREE_API_VERSION` | API version | `2023-08-01` |
| `CASHFREE_WEBHOOK_SECRET` | Secret from Cashfree Webhook dashboard | `your_webhook_signing_secret` |
| `ADMIN_DEFAULT_USER` | Admin username | `admin` |
| `ADMIN_DEFAULT_PASS` | Admin password | `your_secure_admin_password` |
| `ADMIN_SESSION_SECRET` | JWT signing secret (>= 64 chars) | `openssl rand -hex 64` |
| `DEVICE_ID` | Hardware Terminal ID | `PB-K01` |
| `DEVICE_AUTH_SECRET` | Shared HMAC secret for Raspberry Pi | `your_shared_device_secret_64_chars` |
| `FILE_SERVING_SECRET` | Secret for time-limited download URLs | `your_file_serving_secret_32_chars` |

---

## 💳 Part 2: Cashfree Payment Gateway Setup

1. In your **[Cashfree Merchant Dashboard](https://merchant.cashfree.com/)**:
   - Go to **Payment Gateway** > **Developers** > **API Keys**.
   - Copy your **App ID** (`CASHFREE_CLIENT_ID`) and **Secret Key** (`CASHFREE_CLIENT_SECRET`).
2. Whitelist your production URL:
   - Under **Developers** > **Allowed Domains / URLs**, add your production domain: `https://your-domain.railway.app`.
3. Configure Webhooks:
   - Go to **Developers** > **Webhooks** > **Add Webhook**.
   - Webhook URL: `https://your-domain.railway.app/api/payments/webhook`
   - Select events: `ORDER.PAID`, `PAYMENT.SUCCESS`, `PAYMENT.FAILED`.

---

## 🍓 Part 3: Raspberry Pi Hardware Kiosk Setup

### 1. Hardware Requirements
- **Raspberry Pi 4 Model B (4GB or 8GB)** or **Raspberry Pi 5**
- **MicroSD Card (32GB+ High Endurance)**
- **Official 7" or 10.1" Capacitive Touchscreen** (or HDMI Touchscreen Display)
- **Monochrome Printer**: Kyocera ECOSYS PA3500x (connected via USB)
- **Color Printer**: Canon MAXIFY GX6170 (connected via USB)
- **Stable Internet**: Ethernet cable (recommended) or 5GHz Wi-Fi

### 2. Operating System Installation
1. Flash **Raspberry Pi OS (64-bit with Desktop)** onto the MicroSD card using the official [Raspberry Pi Imager](https://www.raspberrypi.com/software/).
2. In the OS customization settings:
   - Username: `pi`
   - Set a strong password
   - Configure Wi-Fi / SSH
   - Enable SSH service

### 3. Automated Kiosk & CUPS Provisioning
Boot up the Raspberry Pi, open a terminal, and run:

```bash
# Clone the repository
git clone https://github.com/kaleprem5152/PrintBar_Production.git /home/pi/printbar-source

# Copy the agent folder into place
cp -r /home/pi/printbar-source/raspberry-pi-agent /home/pi/printbar-agent
cd /home/pi/printbar-agent

# Make setup script executable and run it
chmod +x setup.sh
./setup.sh
```

The script will automatically:
1. Update system packages and install CUPS print server, CUPS client, Python 3, Chromium, and unclutter.
2. Grant user `pi` lpadmin permissions and enable CUPS remote management.
3. Create an isolated Python virtual environment (`venv`) and install all required libraries.
4. Pre-register printer queues for **Kyocera_PA3500x** and **Canon_GX6170**.
5. Install and enable systemd auto-start services (`printbar-agent.service` and `printbar-kiosk.service`).
6. Configure display autostart to hide the mouse cursor and disable screen sleeping.

### 4. Configure Raspberry Pi Environment Variables
Create the production configuration on the Pi:

```bash
cp /home/pi/printbar-agent/.env.example /home/pi/printbar-agent/.env
nano /home/pi/printbar-agent/.env
```

Enter your cloud deployment details:
```env
# Cloud API URL (no trailing slash)
CLOUD_API_URL=https://your-domain.railway.app

# Device Identity (must match DEVICE_ID in cloud environment)
DEVICE_ID=PB-K01

# Shared secret for HMAC-SHA256 authentication (must match DEVICE_AUTH_SECRET in cloud)
DEVICE_AUTH_SECRET=your_shared_device_secret_64_chars

# CUPS Queue Names
KYOCERA_QUEUE=Kyocera_PA3500x
CANON_QUEUE=Canon_GX6170

# Polling interval
POLL_INTERVAL_SECONDS=3
HEARTBEAT_INTERVAL_SECONDS=30
```

### 5. Update Kiosk Touchscreen URL
Edit `/etc/systemd/system/printbar-kiosk.service`:
```bash
sudo nano /etc/systemd/system/printbar-kiosk.service
```
Replace the URL on line 25 with your live cloud kiosk URL:
```ini
ExecStart=/usr/bin/chromium-browser \
    --kiosk \
    --noerrdialogs \
    --disable-infobars \
    --disable-translate \
    --no-first-run \
    --fast \
    --fast-start \
    --disable-features=Translate \
    --touch-events=enabled \
    --enable-features=OverlayScrollbar \
    --overscroll-history-navigation=0 \
    https://your-domain.railway.app/kiosk
```
Save (`Ctrl+O`, `Enter`) and exit (`Ctrl+X`).

### 6. Verify Printers in CUPS
Connect both printers via USB, then check their status:
```bash
lpstat -p -d
```
You can also open the CUPS web interface in a browser:
`http://localhost:631` (or `http://<pi-ip-address>:631` from another computer on the local network).
Ensure **Kyocera_PA3500x** and **Canon_GX6170** are set to **Accepting Jobs** and **Idle**.

### 7. Start & Enable All Services
```bash
sudo systemctl daemon-reload
sudo systemctl restart printbar-agent
sudo systemctl restart printbar-kiosk
```

To verify logs in real time:
```bash
# Agent logs (heartbeats, job claims, print progress)
journalctl -u printbar-agent.service -f

# Kiosk logs
journalctl -u printbar-kiosk.service -f
```

Reboot to verify complete cold-boot auto-start:
```bash
sudo reboot
```

---

## 🛠 Operations & Admin Management

Access the operations console at `https://your-domain.railway.app/admin`:
- **Default Username:** `admin`
- **Default Password:** `printbar2026` (change in production via `ADMIN_DEFAULT_PASS`)

### Capabilities:
- **Live Revenue Metrics:** Real-time revenue, total sheets printed, and job success rates.
- **Kiosk Hardware Health:** Live paper status, toner level, and heartbeat connectivity for terminal `PB-K01`.
- **Order Management:** View all print jobs, collection PINs, payment IDs, and customer file details.
- **Manual Overrides:** Force reprint, cancel failed jobs, and trigger emergency maintenance mode.

---

## 📄 License
Commercial proprietary software developed for PrintBar self-service printing ATM kiosks.
