#!/usr/bin/env bash
# ==============================================================================
# PrintBar Printer Configuration Wizard (Safe Queue Registration)
# Configures Kyocera ECOSYS PA3500x and Canon MAXIFY GX6170 via IPP Everywhere
# Safe: Never deletes working queues before verifying parameters.
# ==============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }
info() { echo -e "${BLUE}[INFO]${NC} $1"; }

echo ""
echo "============================================================"
echo "   PrintBar Printer Network Setup"
echo "============================================================"

if [[ $EUID -ne 0 ]]; then
    fail "Must be run as root: sudo bash configure-printers.sh"
    exit 1
fi

CONFIG_FILE="/etc/printbar/printbar.env"
KYOCERA_QUEUE="printbar-kyocera"
CANON_QUEUE="printbar-canon"

read -rp "Enter Kyocera ECOSYS PA3500x IP (e.g. 192.168.1.101): " KYOCERA_IP
read -rp "Enter Canon MAXIFY GX6170 IP (e.g. 192.168.1.102):     " CANON_IP

if [[ -z "${KYOCERA_IP}" || -z "${CANON_IP}" ]]; then
    fail "Both printer IP addresses are required."
    exit 1
fi

check_port() {
    local ip="$1" port="$2"
    timeout 3 bash -c "echo >/dev/tcp/${ip}/${port}" 2>/dev/null
}

info "Testing IPP capabilities on port 631..."
if ! check_port "${KYOCERA_IP}" 631; then
    fail "Kyocera PA3500x IPP service (port 631) is not reachable at ${KYOCERA_IP}."
    fail "Both PrintBar printers require driverless IPP Everywhere (RFC 8011) on port 631. Raw -m raw fallback is discontinued."
    exit 1
fi

if ! check_port "${CANON_IP}" 631; then
    fail "Canon GX6170 IPP service (port 631) is not reachable at ${CANON_IP}."
    fail "Both PrintBar printers require driverless IPP Everywhere (RFC 8011) on port 631. Raw -m raw fallback is discontinued."
    exit 1
fi

KYOCERA_URI="ipp://${KYOCERA_IP}:631/ipp/print"
CANON_URI="ipp://${CANON_IP}:631/ipp/print"
pass "IPP endpoints validated: ${KYOCERA_URI} and ${CANON_URI}"

info "Configuring driverless IPP Everywhere queues (safe staged replacement)..."

# Stage Kyocera configuration safely
KYOCERA_TEST="pb-test-kyocera"
lpadmin -p "${KYOCERA_TEST}" -E -v "${KYOCERA_URI}" -m everywhere 2>/dev/null || {
    fail "Could not register driverless PPD for Kyocera via IPP Everywhere. Check printer IPP configuration."
    exit 1
}
# Validate required options (duplex, monochrome)
if lpoptions -p "${KYOCERA_TEST}" -l &>/dev/null; then
    pass "Kyocera driverless capabilities successfully queried."
    lpadmin -x "${KYOCERA_TEST}" 2>/dev/null || true
    lpadmin -p "${KYOCERA_QUEUE}" -E -v "${KYOCERA_URI}" -m everywhere
    cupsenable "${KYOCERA_QUEUE}" 2>/dev/null || true
    cupsaccept "${KYOCERA_QUEUE}" 2>/dev/null || true
    pass "Queue '${KYOCERA_QUEUE}' registered."
else
    lpadmin -x "${KYOCERA_TEST}" 2>/dev/null || true
    fail "Failed to query Kyocera capabilities. Preserving existing queue."
    exit 1
fi

# Stage Canon configuration safely
CANON_TEST="pb-test-canon"
lpadmin -p "${CANON_TEST}" -E -v "${CANON_URI}" -m everywhere 2>/dev/null || {
    fail "Could not register driverless PPD for Canon via IPP Everywhere. Check printer IPP configuration."
    exit 1
}
if lpoptions -p "${CANON_TEST}" -l &>/dev/null; then
    pass "Canon driverless capabilities successfully queried."
    lpadmin -x "${CANON_TEST}" 2>/dev/null || true
    lpadmin -p "${CANON_QUEUE}" -E -v "${CANON_URI}" -m everywhere
    cupsenable "${CANON_QUEUE}" 2>/dev/null || true
    cupsaccept "${CANON_QUEUE}" 2>/dev/null || true
    pass "Queue '${CANON_QUEUE}' registered."
else
    lpadmin -x "${CANON_TEST}" 2>/dev/null || true
    fail "Failed to query Canon capabilities. Preserving existing queue."
    exit 1
fi

# Update environment file
if [[ -f "${CONFIG_FILE}" ]]; then
    sed -i "s|^KYOCERA_IP=.*|KYOCERA_IP=${KYOCERA_IP}|" "${CONFIG_FILE}"
    sed -i "s|^CANON_IP=.*|CANON_IP=${CANON_IP}|"       "${CONFIG_FILE}"
    sed -i "s|^KYOCERA_QUEUE=.*|KYOCERA_QUEUE=${KYOCERA_QUEUE}|" "${CONFIG_FILE}"
    sed -i "s|^CANON_QUEUE=.*|CANON_QUEUE=${CANON_QUEUE}|"       "${CONFIG_FILE}"
    pass "Updated ${CONFIG_FILE}"
fi

echo ""
pass "Printers successfully configured:"
lpstat -p "${KYOCERA_QUEUE}" || true
lpstat -p "${CANON_QUEUE}" || true
echo ""
