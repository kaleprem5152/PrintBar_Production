#!/usr/bin/env bash
# ==============================================================================
# PrintBar System Doctor — Diagnostic & Health Check Tool
# Sections: OS, Network, CUPS, Agent, Kiosk, Backend
# Exit 0: no FAILs. Exit 1: at least one FAIL.
# ==============================================================================
set -uo pipefail

CONFIG_FILE="/etc/printbar/printbar.env"
AGENT_DIR="/opt/printbar/agent"
VENV_PYTHON="/opt/printbar/venv/bin/python"
SERVICE_USER="printbar"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'

PASS_COUNT=0; WARN_COUNT=0; FAIL_COUNT=0

pass() { echo -e "${GREEN}[PASS]${NC} $1"; ((PASS_COUNT++)); }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; ((WARN_COUNT++)); }
fail() { echo -e "${RED}[FAIL]${NC} $1"; ((FAIL_COUNT++)); }
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
section() { echo ""; echo -e "${CYAN}── $1 ──${NC}"; }

# Load config
if [[ -f "${CONFIG_FILE}" ]]; then
    # shellcheck disable=SC1090
    set -o allexport; source "${CONFIG_FILE}"; set +o allexport
fi

KYOCERA_IP="${KYOCERA_IP:-}"
CANON_IP="${CANON_IP:-}"
KYOCERA_QUEUE="${KYOCERA_QUEUE:-printbar-kyocera}"
CANON_QUEUE="${CANON_QUEUE:-printbar-canon}"
CLOUD_API_URL="${CLOUD_API_URL:-}"
DEVICE_AUTH_SECRET="${DEVICE_AUTH_SECRET:-}"
DEVICE_ID="${DEVICE_ID:-PB-K01}"

check_tcp() {
    local ip="$1" port="$2"
    timeout 3 bash -c "echo >/dev/tcp/${ip}/${port}" 2>/dev/null
}

echo ""
echo "============================================================"
echo "   PrintBar System Doctor"
echo "   $(date)"
echo "============================================================"

# ==============================================================================
section "1. Hardware & OS"
# ==============================================================================
if grep -qi "raspberry pi" /proc/device-tree/model 2>/dev/null; then
    MODEL=$(cat /proc/device-tree/model 2>/dev/null | tr -d '\0')
    pass "Running on: ${MODEL}"
else
    warn "Not detected as Raspberry Pi hardware"
fi

OS_ID=$(grep '^PRETTY_NAME=' /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '"') || OS_ID="unknown"
info "OS: ${OS_ID}"

TEMP=""
if [[ -f /sys/class/thermal/thermal_zone0/temp ]]; then
    RAW=$(cat /sys/class/thermal/thermal_zone0/temp)
    TEMP=$(echo "scale=1; ${RAW}/1000" | bc)
    if (( $(echo "${TEMP} < 80" | bc -l) )); then
        pass "CPU temperature: ${TEMP}°C"
    else
        warn "CPU temperature high: ${TEMP}°C"
    fi
else
    warn "Cannot read CPU temperature"
fi

# ==============================================================================
section "2. Network"
# ==============================================================================
# Internet
if curl -s --max-time 5 https://1.1.1.1 >/dev/null 2>&1; then
    pass "Internet connectivity: OK"
else
    warn "No internet connectivity — cloud API will be unreachable"
fi

# Cloud URL
if [[ -n "${CLOUD_API_URL}" ]]; then
    HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "${CLOUD_API_URL}/api/health" 2>/dev/null || echo "000")
    if [[ "${HTTP}" == "200" ]]; then
        pass "Cloud API reachable: ${CLOUD_API_URL} → HTTP ${HTTP}"
    else
        warn "Cloud API returned HTTP ${HTTP}: ${CLOUD_API_URL}/api/health"
    fi
else
    fail "CLOUD_API_URL not configured"
fi

# Kyocera network
if [[ -n "${KYOCERA_IP}" ]]; then
    if check_tcp "${KYOCERA_IP}" 631; then
        pass "Kyocera ${KYOCERA_IP}:631 (IPP) reachable"
    elif check_tcp "${KYOCERA_IP}" 9100; then
        warn "Kyocera IPP (631) blocked but RAW (9100) reachable"
    else
        fail "Kyocera ${KYOCERA_IP} not reachable on port 631 or 9100"
    fi
else
    fail "KYOCERA_IP not configured"
fi

# Canon network
if [[ -n "${CANON_IP}" ]]; then
    if check_tcp "${CANON_IP}" 631; then
        pass "Canon ${CANON_IP}:631 (IPP) reachable"
    elif check_tcp "${CANON_IP}" 9100; then
        warn "Canon IPP (631) blocked but RAW (9100) reachable"
    else
        fail "Canon ${CANON_IP} not reachable on port 631 or 9100"
    fi
else
    fail "CANON_IP not configured"
fi

# ==============================================================================
section "3. CUPS Printing"
# ==============================================================================
if systemctl is-active --quiet cups; then
    pass "CUPS service is running"
else
    fail "CUPS service is NOT running (run: sudo systemctl start cups)"
fi

for QUEUE in "${KYOCERA_QUEUE}" "${CANON_QUEUE}"; do
    if lpstat -p "${QUEUE}" 2>/dev/null | grep -q "is idle\|is printing"; then
        pass "CUPS queue '${QUEUE}' is ready"
    elif lpstat -p "${QUEUE}" 2>/dev/null | grep -q "disabled"; then
        fail "CUPS queue '${QUEUE}' is disabled (run: sudo cupsenable ${QUEUE})"
    else
        fail "CUPS queue '${QUEUE}' not found (run: sudo bash configure-printers.sh)"
    fi
done

# ==============================================================================
section "4. Agent"
# ==============================================================================
if [[ -f "${VENV_PYTHON}" ]]; then
    pass "Python venv: ${VENV_PYTHON}"
else
    fail "Python venv missing: ${VENV_PYTHON}"
fi

for PY_FILE in agent.py config.py auth.py db.py cups_manager.py printer_monitor.py; do
    if [[ -f "${AGENT_DIR}/${PY_FILE}" ]]; then
        if "${VENV_PYTHON}" -m py_compile "${AGENT_DIR}/${PY_FILE}" 2>/dev/null; then
            pass "Python syntax OK: ${PY_FILE}"
        else
            fail "Python syntax error in: ${PY_FILE}"
        fi
    else
        fail "Missing agent file: ${AGENT_DIR}/${PY_FILE}"
    fi
done

if [[ -f "${CONFIG_FILE}" ]]; then
    pass "Config file: ${CONFIG_FILE}"
else
    fail "Config file missing: ${CONFIG_FILE}"
fi

if [[ -z "${DEVICE_AUTH_SECRET}" ]] || [[ "${DEVICE_AUTH_SECRET}" == "change-this-in-production" ]]; then
    fail "DEVICE_AUTH_SECRET is empty or placeholder — regenerate with: openssl rand -hex 32"
elif [[ ${#DEVICE_AUTH_SECRET} -lt 32 ]]; then
    warn "DEVICE_AUTH_SECRET seems short (${#DEVICE_AUTH_SECRET} chars) — recommend 64+ hex chars"
else
    pass "DEVICE_AUTH_SECRET is set (${#DEVICE_AUTH_SECRET} chars)"
fi

if systemctl is-active --quiet printbar-agent; then
    pass "printbar-agent service: running"
    UPTIME=$(systemctl show printbar-agent --property=ActiveEnterTimestamp | cut -d= -f2)
    info "  Running since: ${UPTIME}"
else
    warn "printbar-agent service: not running (start with: sudo systemctl start printbar-agent)"
fi

if id "${SERVICE_USER}" &>/dev/null; then
    pass "Service user '${SERVICE_USER}' exists"
else
    fail "Service user '${SERVICE_USER}' missing — run install.sh"
fi

# ==============================================================================
section "5. Kiosk Display"
# ==============================================================================
if systemctl is-active --quiet printbar-kiosk 2>/dev/null; then
    pass "printbar-kiosk service: running"
else
    warn "printbar-kiosk service: not running (OK if running headless)"
fi

CHROMIUM_BIN=$(command -v chromium-browser 2>/dev/null || command -v chromium 2>/dev/null || echo "")
if [[ -n "${CHROMIUM_BIN}" ]]; then
    pass "Chromium found: ${CHROMIUM_BIN}"
else
    warn "Chromium not found — install chromium-browser"
fi

# ==============================================================================
section "6. Directories & Permissions"
# ==============================================================================
for DIR in /opt/printbar /var/lib/printbar /etc/printbar; do
    if [[ -d "${DIR}" ]]; then
        pass "Directory exists: ${DIR}"
    else
        fail "Directory missing: ${DIR}"
    fi
done

if [[ -f /etc/sudoers.d/printbar ]]; then
    if visudo -c -f /etc/sudoers.d/printbar >/dev/null 2>&1; then
        pass "Sudoers file valid: /etc/sudoers.d/printbar"
    else
        fail "Sudoers file has syntax errors"
    fi
else
    warn "Sudoers file missing — CUPS restart commands may require manual sudo"
fi

# ==============================================================================
section "Summary"
# ==============================================================================
echo ""
echo -e "  ${GREEN}PASS: ${PASS_COUNT}${NC}  ${YELLOW}WARN: ${WARN_COUNT}${NC}  ${RED}FAIL: ${FAIL_COUNT}${NC}"
echo ""

if [[ ${FAIL_COUNT} -gt 0 ]]; then
    echo -e "${RED}System has ${FAIL_COUNT} critical issue(s) — resolve before commissioning.${NC}"
    exit 1
elif [[ ${WARN_COUNT} -gt 0 ]]; then
    echo -e "${YELLOW}System has warnings. Review before going live.${NC}"
    exit 0
else
    echo -e "${GREEN}All checks passed. System is ready.${NC}"
    exit 0
fi

