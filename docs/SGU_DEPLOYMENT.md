# PrintBar SGU Kiosk Deployment Guide

## 1. Hardware Architecture (Sanjay Ghodawat University — Food Court)
- **Kiosk Unit**: `PB-K01`
- **Controller**: Raspberry Pi 5 (8GB)
- **Monochrome Printer**: Kyocera ECOSYS PA3500x (Ethernet static IP `192.168.1.101`)
- **Colour Printer**: Canon MAXIFY GX6170 (Ethernet static IP `192.168.1.102`)
- **Networking**: Gigabit Ethernet switch connecting the Pi, both printers, and campus network.

---

## 2. Raspberry Pi 5 Initial Setup

### 2.1 OS & Dependencies
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y cups cups-client libcups2-dev python3 python3-pip python3-venv build-essential
```

### 2.2 Configure CUPS Queues
```bash
# Add Kyocera ECOSYS PA3500x queue
sudo lpadmin -p Kyocera_PA3500x -E -v socket://192.168.1.101:9100 -m everywhere

# Add Canon MAXIFY GX6170 queue
sudo lpadmin -p Canon_GX6170 -E -v socket://192.168.1.102:9100 -m everywhere

# Verify printer queues
lpstat -p -d
```

### 2.3 Agent Service Setup
1. Clone repository to `/home/pi/printbar`:
```bash
git clone https://github.com/kaleprem5152/PrintBar_Production /home/pi/printbar
cd /home/pi/printbar/printbar-product-design-project/raspberry-pi-agent
```

2. Create virtual environment & install requirements:
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

3. Configure `.env` on the Raspberry Pi:
```bash
CLOUD_API_URL=https://printbarproduction-production.up.railway.app
DEVICE_ID=PB-K01
DEVICE_AUTH_SECRET=<YOUR_SECURE_DEVICE_SECRET>
POLL_INTERVAL_SECONDS=3
HEARTBEAT_INTERVAL_SECONDS=30
KYOCERA_QUEUE=Kyocera_PA3500x
CANON_QUEUE=Canon_GX6170
```

4. Install systemd service:
```bash
sudo cp printbar-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable printbar-agent
sudo systemctl start printbar-agent
```

5. Monitor live agent logs:
```bash
journalctl -u printbar-agent -f
```

---

## 3. Paper Management & Tray Refills
- Kyocera PA3500x has a 250-sheet paper tray.
- Canon MAXIFY GX6170 has a 250-sheet paper tray.
- When an operator reloads paper at the SGU food court:
  1. Open Admin Dashboard at `https://printbarproduction-production.up.railway.app/admin`.
  2. Navigate to **Kiosks & Hardware**.
  3. Click **Refill Paper (+250 sheets)** for the appropriate printer.
  4. The system resets the paper counter to 250 and clears any out-of-paper blocks immediately.

