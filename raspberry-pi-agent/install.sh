#!/usr/bin/env bash
# ==============================================================================
# PrintBar Raspberry Pi Production Installer v3.0
# Target: Raspberry Pi OS 64-bit (Debian Bookworm/Bullseye)
# Installs to /opt/printbar/agent, config at /etc/printbar/printbar.env
# Idempotent: safe to re-run after partial failures
# ==============================================================================
set -euo pipefail

PRINTBAR_VERSION="3.0.0"
INSTALL_PREFIX="/opt/printbar"
AGENT_DIR="${INSTALL_PREFIX}/agent"
VENV_DIR="${INSTALL_PREFIX}/venv"
CONFIG_DIR="/etc/printbar"
CONFIG_FILE="${CONFIG_DIR}/printbar.env"
DATA_DIR="/var/lib/printbar"
JOBS_DIR="${DATA_DIR}/jobs"
LOG_DIR="/var/log/printbar"
SERVICE_USER="printbar"
SUDOERS_FILE="/etc/sudoers.d/printbar"
SYSTEMD_DIR="/etc/systemd/system"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }
info() { echo -e "${BLUE}[INFO]${NC} $1"; }

echo ""
echo "============================================================"
echo "   PrintBar Kiosk Installer v${PRINTBAR_VERSION}"
echo "   Target: PB-K01 — SGU Food Court"
echo "============================================================"
echo ""

# --- Root check ---
if [[ $EUID -ne 0 ]]; then
    fail "This installer must be run as root: sudo bash install.sh"
    exit 1
fi

# --- Raspberry Pi check ---
if grep -qi "raspberry pi" /proc/device-tree/model 2>/dev/null; then
    pass "Running on Raspberry Pi hardware"
else
    warn "Not detected as Raspberry Pi — proceeding anyway (CI/test mode)"
fi

# --- Detect actual user ---
INSTALL_USER="${SUDO_USER:-$(logname 2>/dev/null || echo pi)}"
info "Installing for user: ${INSTALL_USER}"

# ==============================================================================
# 1. System packages
# ==============================================================================
info "[1/9] Installing system packages..."
apt-get update -qq
apt-get install -y --no-install-recommends \
    cups cups-client cups-bsd libcups2-dev \
    python3 python3-pip python3-venv python3-dev \
    python3-psutil \
    chromium-browser unclutter \
    curl git jq \
    avahi-utils \
    openssl
pass "System packages installed"

# ==============================================================================
# 2. Create service user
# ==============================================================================
info "[2/9] Creating service user '${SERVICE_USER}'..."
if id "${SERVICE_USER}" &>/dev/null; then
    warn "User '${SERVICE_USER}' already exists — skipping creation"
else
    useradd -r -s /sbin/nologin -d "${DATA_DIR}" "${SERVICE_USER}"
    pass "Service user '${SERVICE_USER}' created"
fi

# Add to lpadmin group for CUPS access
usermod -aG lpadmin "${SERVICE_USER}" 2>/dev/null || true
usermod -aG lpadmin "${INSTALL_USER}" 2>/dev/null || true

# ==============================================================================
# 3. Install agent code
# ==============================================================================
info "[3/9] Installing agent code to ${AGENT_DIR}..."
mkdir -p "${AGENT_DIR}"
# Copy agent files from current directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp -f "${SCRIPT_DIR}/agent.py"           "${AGENT_DIR}/"
cp -f "${SCRIPT_DIR}/config.py"          "${AGENT_DIR}/"
cp -f "${SCRIPT_DIR}/auth.py"            "${AGENT_DIR}/"
cp -f "${SCRIPT_DIR}/db.py"              "${AGENT_DIR}/"
cp -f "${SCRIPT_DIR}/cups_manager.py"    "${AGENT_DIR}/"
cp -f "${SCRIPT_DIR}/printer_monitor.py" "${AGENT_DIR}/"
cp -f "${SCRIPT_DIR}/requirements.txt"   "${AGENT_DIR}/"

# Set ownership
chown -R root:root "${AGENT_DIR}"
chmod 755 "${AGENT_DIR}"
chmod 644 "${AGENT_DIR}"/*.py "${AGENT_DIR}/requirements.txt"
pass "Agent code installed"

# ==============================================================================
# 4. Python virtual environment
# ==============================================================================
info "[4/9] Setting up Python virtual environment..."
if [[ ! -f "${VENV_DIR}/bin/python" ]]; then
    python3 -m venv "${VENV_DIR}"
    pass "Virtual environment created"
else
    warn "Virtual environment already exists — upgrading packages"
fi

"${VENV_DIR}/bin/pip" install --upgrade pip --quiet
"${VENV_DIR}/bin/pip" install -r "${AGENT_DIR}/requirements.txt" --quiet
pass "Python dependencies installed"

# ==============================================================================
# 5. Data and log directories
# ==============================================================================
info "[5/9] Creating data directories..."
mkdir -p "${DATA_DIR}" "${JOBS_DIR}" "${LOG_DIR}"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${DATA_DIR}" "${LOG_DIR}"
chmod 750 "${DATA_DIR}" "${LOG_DIR}"
chmod 700 "${JOBS_DIR}"
pass "Data directories ready"

# ==============================================================================
# 6. Configuration file
# ==============================================================================
info "[6/9] Setting up configuration..."
mkdir -p "${CONFIG_DIR}"
chmod 750 "${CONFIG_DIR}"

if [[ -f "${CONFIG_FILE}" ]]; then
    warn "Config file already exists at ${CONFIG_FILE} — NOT overwriting (run upgrade.sh to update)"
else
    # Generate a fresh secret
    GENERATED_SECRET=$(openssl rand -hex 32)
    cat > "${CONFIG_FILE}" <<EOF
# PrintBar Agent Production Configuration
# Generated by installer on $(date -Iseconds)
# EDIT THIS FILE with your actual values before starting the service.

CLOUD_API_URL=https://printbarproduction-production.up.railway.app
DEVICE_ID=PB-K01
DEVICE_AUTH_SECRET=${GENERATED_SECRET}

# Printer IPs — REQUIRED. Assign static IPs via your router DHCP reservation.
KYOCERA_IP=
CANON_IP=

KYOCERA_QUEUE=printbar-kyocera
CANON_QUEUE=printbar-canon
KYOCERA_PORT=9100
CANON_PORT=9100

POLL_INTERVAL_SECONDS=3
HEARTBEAT_INTERVAL_SECONDS=30
COMMAND_POLL_INTERVAL=10
PRODUCTION_MODE=true
LOG_LEVEL=INFO

DOCUMENT_STORAGE_DIR=${JOBS_DIR}
LOCAL_DATA_DIR=${DATA_DIR}
KIOSK_URL=https://printbarproduction-production.up.railway.app/kiosk
EOF
    chmod 640 "${CONFIG_FILE}"
    chown root:"${SERVICE_USER}" "${CONFIG_FILE}"
    pass "Configuration file created at ${CONFIG_FILE}"
    warn "ACTION REQUIRED: Edit ${CONFIG_FILE} and set KYOCERA_IP, CANON_IP before starting the service."
fi

# ==============================================================================
# 7. Sudoers (minimal — only what CUPS management needs)
# ==============================================================================
info "[7/9] Installing sudoers rules..."
cat > "${SUDOERS_FILE}" <<'EOF'
# PrintBar agent — minimal CUPS management permissions
printbar ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart cups
printbar ALL=(ALL) NOPASSWD: /usr/sbin/lpadmin
printbar ALL=(ALL) NOPASSWD: /usr/bin/lpstat
printbar ALL=(ALL) NOPASSWD: /usr/bin/lp
printbar ALL=(ALL) NOPASSWD: /usr/bin/cancel
EOF
chmod 440 "${SUDOERS_FILE}"
visudo -c -f "${SUDOERS_FILE}" || { fail "Sudoers file syntax error!"; rm -f "${SUDOERS_FILE}"; exit 1; }
pass "Sudoers rules installed"

# ==============================================================================
# 8. Systemd services
# ==============================================================================
info "[8/9] Installing systemd services..."

# Detect display/session for kiosk service
DISPLAY_ENV=":0"
XAUTH_PATH="/home/${INSTALL_USER}/.Xauthority"

cat > "${SYSTEMD_DIR}/printbar-agent.service" <<EOF
[Unit]
Description=PrintBar Hardware & CUPS Print Agent (PB-K01)
After=network-online.target cups.service
Wants=network-online.target cups.service
Requires=cups.service

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${AGENT_DIR}
EnvironmentFile=${CONFIG_FILE}
Environment=PYTHONUNBUFFERED=1
Environment=PYTHONPATH=${AGENT_DIR}
ExecStart=${VENV_DIR}/bin/python -u ${AGENT_DIR}/agent.py
Restart=on-failure
RestartSec=10
StartLimitIntervalSec=120
StartLimitBurst=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=printbar-agent
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=${DATA_DIR} ${LOG_DIR}
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
EOF

# Detect chromium binary
CHROMIUM_BIN=$(command -v chromium-browser 2>/dev/null || command -v chromium 2>/dev/null || echo "chromium-browser")

cat > "${SYSTEMD_DIR}/printbar-kiosk.service" <<EOF
[Unit]
Description=PrintBar Kiosk Browser Display
After=graphical-session.target network-online.target printbar-agent.service
Wants=graphical-session.target

[Service]
Type=simple
User=${INSTALL_USER}
Environment=DISPLAY=${DISPLAY_ENV}
Environment=XAUTHORITY=${XAUTH_PATH}
EnvironmentFile=${CONFIG_FILE}
ExecStartPre=/bin/sleep 5
ExecStart=${CHROMIUM_BIN} \\
    --kiosk \\
    --no-sandbox \\
    --disable-infobars \\
    --disable-session-crashed-bubble \\
    --disable-restore-session-state \\
    --disable-background-networking \\
    --noerrdialogs \\
    --check-for-update-interval=31536000 \\
    --ozone-platform-hint=auto \\
    \${KIOSK_URL}
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=printbar-kiosk

[Install]
WantedBy=graphical-session.target
EOF

systemctl daemon-reload
systemctl enable printbar-agent.service
# kiosk service requires graphical session — enable only if desktop is detected
if systemctl list-units --type=target | grep -q graphical.target; then
    systemctl enable printbar-kiosk.service
    pass "printbar-kiosk.service enabled"
else
    warn "No graphical target detected — printbar-kiosk.service not enabled"
fi
pass "Systemd services installed"

# ==============================================================================
# 9. CUPS configuration
# ==============================================================================
info "[9/9] Configuring CUPS..."
systemctl enable cups
systemctl start cups || true
cupsctl --remote-admin --share-printers 2>/dev/null || true
pass "CUPS configured"

# ==============================================================================
# Summary
# ==============================================================================
echo ""
echo "============================================================"
echo "   PrintBar Installer Complete"
echo "============================================================"
echo ""
pass "Agent code:  ${AGENT_DIR}"
pass "Config:      ${CONFIG_FILE}"
pass "Data:        ${DATA_DIR}"
pass "Services:    printbar-agent, printbar-kiosk"
echo ""
echo -e "${YELLOW}NEXT STEPS:${NC}"
echo " 1. Edit ${CONFIG_FILE} — set KYOCERA_IP and CANON_IP"
echo " 2. Run printer setup: sudo bash ${SCRIPT_DIR}/configure-printers.sh"
echo " 3. Start agent: sudo systemctl start printbar-agent"
echo " 4. Run health check: sudo bash ${SCRIPT_DIR}/doctor.sh"
echo " 5. Reboot: sudo reboot"
echo ""

