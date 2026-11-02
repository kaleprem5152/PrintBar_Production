#!/usr/bin/env bash
# ==============================================================================
# PrintBar Raspberry Pi Automated Hardware & Kiosk Provisioning Script
# Target OS: Raspberry Pi OS (64-bit Debian Bookworm / Bullseye)
# ==============================================================================
set -euo pipefail

echo "========================================="
echo "   PRINTBAR KIOSK SETUP & PROVISIONING   "
echo "========================================="

# 1. System updates & CUPS installation
echo "[1/6] Updating packages & installing CUPS + Python + Chromium..."
sudo apt-get update -y
sudo apt-get install -y \
    cups \
    cups-client \
    cups-bsd \
    printer-driver-all \
    python3 \
    python3-pip \
    python3-venv \
    chromium-browser \
    unclutter \
    curl \
    git

# 2. CUPS Permissions
echo "[2/6] Configuring CUPS user permissions..."
sudo usermod -aG lpadmin pi
sudo systemctl enable cups
sudo systemctl restart cups

# Allow remote/local CUPS management
sudo cupsctl --remote-admin --remote-any --share-printers

# 3. Setup Agent Directory & Python Virtual Environment
echo "[3/6] Setting up Agent Python virtual environment..."
INSTALL_DIR="/home/pi/printbar-agent"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

if [ ! -d "venv" ]; then
    python3 -m venv venv
fi

./venv/bin/pip install --upgrade pip
./venv/bin/pip install -r requirements.txt

# 4. Printer Queue Registration Helper
echo "[4/6] Registering Kyocera and Canon CUPS printer queues..."
echo "Note: Plug in both Kyocera and Canon USB cables."
# List detected USB printers
lsusb || true

# Register Kyocera PA3500x if PPD is present, or configure via generic PostScript
echo "Configuring Kyocera_PA3500x queue..."
lpadmin -p Kyocera_PA3500x -E -v usb://Kyocera -m everywhere 2>/dev/null || \
lpadmin -p Kyocera_PA3500x -E -v usb://Kyocera -m lsb/usr/cups-included/postscript.ppd 2>/dev/null || \
echo "Notice: Kyocera will register automatically when plugged via USB."

# Register Canon GX6170
echo "Configuring Canon_GX6170 queue..."
lpadmin -p Canon_GX6170 -E -v usb://Canon -m everywhere 2>/dev/null || \
echo "Notice: Canon will register automatically when plugged via USB."

# 5. Install systemd services
echo "[5/6] Installing systemd services..."
sudo cp printbar-agent.service /etc/systemd/system/
sudo cp printbar-kiosk.service /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable printbar-agent.service
sudo systemctl enable printbar-kiosk.service

# 6. Hide mouse cursor in kiosk
echo "[6/6] Configuring kiosk display autostart (hide cursor)..."
mkdir -p /home/pi/.config/lxsession/LXDE-pi/
cat << 'EOF' > /home/pi/.config/lxsession/LXDE-pi/autostart
@lxpanel --profile LXDE-pi
@pcmanfm --desktop --profile LXDE-pi
@xscreensaver -no-splash
@xset s off
@xset -dpms
@xset s noblank
@unclutter -idle 0.1 -root
EOF

echo "========================================="
echo " PrintBar setup complete!"
echo " 1. Edit /home/pi/printbar-agent/.env with your cloud credentials"
echo " 2. Start services with: sudo systemctl start printbar-agent"
echo " 3. Reboot kiosk: sudo reboot"
echo "========================================="
