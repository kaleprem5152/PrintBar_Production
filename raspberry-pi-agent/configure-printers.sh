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

info "Testing network connectivity to printers..."
check_port "${KYOCERA_IP}" 631 && pass "Kyocera IPP (631) reachable" || warn "Kyocera IPP (631) port unreachable"
check_port "${CANON_IP}" 631 && pass "Canon IPP (631) reachable" || warn "Canon IPP (631) port unreachable"

# Determine URIs
KYOCERA_URI="ipp://${KYOCERA_IP}:631/ipp/print"
CANON_URI="ipp://${CANON_IP}:631/ipp/print"

if ! check_port "${KYOCERA_IP}" 631; then
    if check_port "${KYOCERA_IP}" 9100; then
        KYOCERA_URI="socket://${KYOCERA_IP}:9100"
        warn "Using raw socket for Kyocera: ${KYOCERA_URI}"
    else
        fail "Kyocera is not reachable on ports 631 or 9100"
        exit 1
    fi
fi

if ! check_port "${CANON_IP}" 631; then
    if check_port "${CANON_IP}" 9100; then
        CANON_URI="socket://${CANON_IP}:9100"
        warn "Using raw socket for Canon: ${CANON_URI}"
    else
        fail "Canon is not reachable on ports 631 or 9100"
        exit 1
    fi
fi

info "Configuring CUPS queues..."

# Safe configuration without prior queue deletion
lpadmin -p "${KYOCERA_QUEUE}" -E -v "${KYOCERA_URI}" -m everywhere 2>/dev/null || \
lpadmin -p "${KYOCERA_QUEUE}" -E -v "${KYOCERA_URI}" -m raw 2>/dev/null || \
warn "Could not apply driverless PPD for Kyocera"

lpadmin -p "${CANON_QUEUE}" -E -v "${CANON_URI}" -m everywhere 2>/dev/null || \
lpadmin -p "${CANON_QUEUE}" -E -v "${CANON_URI}" -m raw 2>/dev/null || \
warn "Could not apply driverless PPD for Canon"

cupsenable "${KYOCERA_QUEUE}" "${CANON_QUEUE}" 2>/dev/null || true
cupsaccept "${KYOCERA_QUEUE}" "${CANON_QUEUE}" 2>/dev/null || true

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
