#!/usr/bin/env bash
# ==============================================================================
# PrintBar Raspberry Pi Production Installer v3.1
# Target: Raspberry Pi OS 64-bit (Debian Bookworm/Bullseye)
# Installs to /opt/printbar/agent, config at /etc/printbar/printbar.env
# Hardened: No 'pi' assumptions, no remote CUPS admin, no --no-sandbox.
# ==============================================================================
set -euo pipefail

PRINTBAR_VERSION="3.1.0"
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

# 1. Root check
if [[ $EUID -ne 0 ]]; then
    fail "This installer must be run as root: sudo bash install.sh"
    exit 1
fi

# 2. Hardware check
if grep -qi "raspberry pi" /proc/device-tree/model 2>/dev/null; then
    pass "Running on Raspberry Pi hardware"
else
    warn "Not detected as Raspberry Pi — proceeding in generic Linux mode"
fi

# 3. Detect actual desktop kiosk user (never assume 'pi')
DETECTED_USER="${KIOSK_USER:-${SUDO_USER:-}}"
if [[ -z "${DETECTED_USER}" || "${DETECTED_USER}" == "root" ]]; then
    # Find first regular user with UID >= 1000
    DETECTED_USER=$(awk -F: '$3 >= 1000 && $3 < 60000 {print $1; exit}' /etc/passwd || echo "")
fi
if [[ -z "${DETECTED_USER}" ]]; then
    fail "Could not determine local non-root desktop user. Specify with: KIOSK_USER=username sudo bash install.sh"
    exit 1
fi
USER_HOME=$(getent passwd "${DETECTED_USER}" | cut -d: -f6)
info "Target display/desktop user: ${DETECTED_USER} (Home: ${USER_HOME})"

# 4. System packages installation
info "[1/8] Installing system dependencies..."
apt-get update -qq
apt-get install -y --no-install-recommends \
    cups cups-client cups-bsd libcups2-dev \
    python3 python3-pip python3-venv python3-dev \
    python3-psutil \
    unclutter curl git jq \
    openssl

# Locate Chromium executable
CHROMIUM_BIN=$(command -v chromium-browser 2>/dev/null || command -v chromium 2>/dev/null || command -v google-chrome 2>/dev/null || echo "")
if [[ -z "${CHROMIUM_BIN}" ]]; then
    info "Installing chromium..."
    apt-get install -y chromium-browser 2>/dev/null || apt-get install -y chromium 2>/dev/null || true
    CHROMIUM_BIN=$(command -v chromium-browser 2>/dev/null || command -v chromium 2>/dev/null || echo "")
fi

if [[ -n "${CHROMIUM_BIN}" ]]; then
    pass "Chromium binary found: ${CHROMIUM_BIN}"
else
    warn "Chromium not found. Kiosk browser service will require manual package installation."
fi

# 5. Service user setup
info "[2/8] Creating service user '${SERVICE_USER}'..."
if id "${SERVICE_USER}" &>/dev/null; then
    pass "User '${SERVICE_USER}' exists"
else
    useradd -r -s /sbin/nologin -d "${DATA_DIR}" "${SERVICE_USER}"
    pass "Service user '${SERVICE_USER}' created"
fi

# 6. Install agent code
info "[3/8] Deploying agent source to ${AGENT_DIR}..."
mkdir -p "${AGENT_DIR}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp -f "${SCRIPT_DIR}/agent.py"           "${AGENT_DIR}/"
cp -f "${SCRIPT_DIR}/config.py"          "${AGENT_DIR}/"
cp -f "${SCRIPT_DIR}/auth.py"            "${AGENT_DIR}/"
cp -f "${SCRIPT_DIR}/db.py"              "${AGENT_DIR}/"
cp -f "${SCRIPT_DIR}/cups_manager.py"    "${AGENT_DIR}/"
cp -f "${SCRIPT_DIR}/printer_monitor.py" "${AGENT_DIR}/"
cp -f "${SCRIPT_DIR}/requirements.txt"   "${AGENT_DIR}/"
chown -R root:root "${AGENT_DIR}"
chmod 755 "${AGENT_DIR}"
chmod 644 "${AGENT_DIR}"/*.py "${AGENT_DIR}/requirements.txt"
pass "Agent code deployed"

# 7. Python virtual environment
info "[4/8] Configuring Python environment..."
if [[ ! -f "${VENV_DIR}/bin/python" ]]; then
    python3 -m venv "${VENV_DIR}"
fi
"${VENV_DIR}/bin/pip" install --upgrade pip --quiet
"${VENV_DIR}/bin/pip" install -r "${AGENT_DIR}/requirements.txt" --quiet
pass "Python environment ready"

# 8. Data directories
info "[5/8] Initialising data directories..."
mkdir -p "${DATA_DIR}" "${JOBS_DIR}" "${LOG_DIR}"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${DATA_DIR}" "${LOG_DIR}"
chmod 750 "${DATA_DIR}" "${LOG_DIR}"
chmod 700 "${JOBS_DIR}"
pass "Data directories configured"

# 9. Configuration file
info "[6/8] Checking configuration..."
mkdir -p "${CONFIG_DIR}"
chmod 750 "${CONFIG_DIR}"

if [[ -f "${CONFIG_FILE}" ]]; then
    pass "Configuration preserved at ${CONFIG_FILE}"
else
    GENERATED_SECRET=$(openssl rand -hex 32)
    cat > "${CONFIG_FILE}" <<EOF
# PrintBar Agent Production Configuration
# Generated on $(date -Iseconds)

CLOUD_API_URL=https://printbarproduction-production.up.railway.app
DEVICE_ID=PB-K01
DEVICE_AUTH_SECRET=${GENERATED_SECRET}

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
    pass "Created configuration template at ${CONFIG_FILE}"
fi

# 10. Minimal Sudoers
info "[7/8] Securing sudoers privileges..."
cat > "${SUDOERS_FILE}" <<'EOF'
# PrintBar minimal hardware agent permissions
printbar ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart cups
printbar ALL=(ALL) NOPASSWD: /usr/sbin/lpadmin
printbar ALL=(ALL) NOPASSWD: /usr/bin/lpstat
printbar ALL=(ALL) NOPASSWD: /usr/bin/lp
printbar ALL=(ALL) NOPASSWD: /usr/bin/cancel
EOF
chmod 440 "${SUDOERS_FILE}"
visudo -c -f "${SUDOERS_FILE}" || { fail "Sudoers syntax check failed"; exit 1; }
pass "Minimal sudoers established"

# 11. Systemd Units
info "[8/8] Installing systemd units..."

cat > "${SYSTEMD_DIR}/printbar-agent.service" <<EOF
[Unit]
Description=PrintBar Hardware & CUPS Daemon (PB-K01)
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

cat > "${SYSTEMD_DIR}/printbar-kiosk.service" <<EOF
[Unit]
Description=PrintBar Kiosk Fullscreen Browser
After=graphical.target network-online.target printbar-agent.service
Wants=graphical.target

[Service]
Type=simple
User=${DETECTED_USER}
Environment=DISPLAY=:0
Environment=XAUTHORITY=${USER_HOME}/.Xauthority
EnvironmentFile=${CONFIG_FILE}
ExecStartPre=/bin/sleep 5
ExecStart=${CHROMIUM_BIN} \\
    --kiosk \\
    --disable-infobars \\
    --disable-session-crashed-bubble \\
    --disable-restore-session-state \\
    --disable-background-networking \\
    --noerrdialogs \\
    --check-for-update-interval=31536000 \\
    \${KIOSK_URL}
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=printbar-kiosk

[Install]
WantedBy=graphical.target
EOF

systemctl daemon-reload
systemctl enable printbar-agent.service

# Local CUPS configuration (Local only — NO remote administration)
systemctl enable cups
systemctl start cups || true
pass "System services enabled"

echo ""
echo "============================================================"
echo "   Installation Completed Successfully"
echo "============================================================"
echo " Next steps:"
echo " 1. Configure printer static IPs in ${CONFIG_FILE}"
echo " 2. Run 'sudo bash configure-printers.sh' to register CUPS queues"
echo " 3. Verify health with 'sudo bash doctor.sh'"
echo " 4. Start agent: 'sudo systemctl start printbar-agent'"
echo ""
