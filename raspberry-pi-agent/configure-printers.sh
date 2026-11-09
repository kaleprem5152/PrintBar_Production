#!/usr/bin/env bash
# ==============================================================================
# PrintBar Printer Configuration Wizard
# Interactive setup for Kyocera ECOSYS PA3500x and Canon MAXIFY GX6170
# Uses IPP/LAN connections — NOT USB
# ==============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }
info() { echo -e "${BLUE}[INFO]${NC} $1"; }

echo ""
echo "============================================================"
echo "   PrintBar Printer Configuration Wizard"
echo "============================================================"
echo "   Kyocera ECOSYS PA3500x + Canon MAXIFY GX6170"
echo "   Both printers must be on the local LAN (Ethernet)"
echo "============================================================"
echo ""

KYOCERA_QUEUE="printbar-kyocera"
CANON_QUEUE="printbar-canon"
CONFIG_FILE="/etc/printbar/printbar.env"

# --- Root check ---
if [[ $EUID -ne 0 ]]; then
    fail "Must be run as root: sudo bash configure-printers.sh"
    exit 1
fi

# --- Get IPs ---
read -rp "Enter Kyocera ECOSYS PA3500x IP address (e.g. 192.168.1.101): " KYOCERA_IP
read -rp "Enter Canon MAXIFY GX6170 IP address (e.g. 192.168.1.102):     " CANON_IP

echo ""
info "Testing network connectivity..."

# TCP reachability
check_tcp() {
    local ip="$1" port="$2"
    timeout 3 bash -c "echo >/dev/tcp/${ip}/${port}" 2>/dev/null
}

KYOCERA_IPP_OK=false; KYOCERA_RAW_OK=false
CANON_IPP_OK=false;   CANON_RAW_OK=false

check_tcp "${KYOCERA_IP}" 631 && KYOCERA_IPP_OK=true && pass "Kyocera port 631 (IPP) reachable" || warn "Kyocera port 631 not reachable"
check_tcp "${KYOCERA_IP}" 9100 && KYOCERA_RAW_OK=true && pass "Kyocera port 9100 (RAW) reachable" || warn "Kyocera port 9100 not reachable"
check_tcp "${CANON_IP}"   631 && CANON_IPP_OK=true   && pass "Canon port 631 (IPP) reachable"    || warn "Canon port 631 not reachable"
check_tcp "${CANON_IP}"   9100 && CANON_RAW_OK=true  && pass "Canon port 9100 (RAW) reachable"   || warn "Canon port 9100 not reachable"

# Choose URI
if $KYOCERA_IPP_OK; then
    KYOCERA_URI="ipp://${KYOCERA_IP}:631/ipp/print"
elif $KYOCERA_RAW_OK; then
    KYOCERA_URI="socket://${KYOCERA_IP}:9100"
    warn "Kyocera IPP not reachable — using raw socket"
else
    fail "Kyocera printer is not reachable on the network. Check IP and cable."
    exit 1
fi

if $CANON_IPP_OK; then
    CANON_URI="ipp://${CANON_IP}:631/ipp/print"
elif $CANON_RAW_OK; then
    CANON_URI="socket://${CANON_IP}:9100"
    warn "Canon IPP not reachable — using raw socket"
else
    fail "Canon printer is not reachable on the network. Check IP and cable."
    exit 1
fi

echo ""
info "Registering CUPS queues..."

# Remove old queues if exist (idempotent)
lpadmin -x "${KYOCERA_QUEUE}" 2>/dev/null && warn "Removed old ${KYOCERA_QUEUE} queue" || true
lpadmin -x "${CANON_QUEUE}"   2>/dev/null && warn "Removed old ${CANON_QUEUE} queue"   || true

# Register Kyocera — IPP Everywhere (driverless)
info "Registering ${KYOCERA_QUEUE} → ${KYOCERA_URI}"
if lpadmin -p "${KYOCERA_QUEUE}" -E -v "${KYOCERA_URI}" -m everywhere 2>/dev/null; then
    pass "Kyocera queue registered (IPP Everywhere / driverless)"
else
    # Fallback to generic PCL
    lpadmin -p "${KYOCERA_QUEUE}" -E -v "${KYOCERA_URI}" -m lsb/usr/cups-included/generic-postscript.ppd 2>/dev/null || \
    lpadmin -p "${KYOCERA_QUEUE}" -E -v "${KYOCERA_URI}" -P /usr/share/ppd/cupsfilters/Generic-PDF_Printer-PDF.ppd
    warn "Kyocera registered with fallback PPD — IPP Everywhere unavailable"
fi

# Register Canon — IPP Everywhere
info "Registering ${CANON_QUEUE} → ${CANON_URI}"
if lpadmin -p "${CANON_QUEUE}" -E -v "${CANON_URI}" -m everywhere 2>/dev/null; then
    pass "Canon queue registered (IPP Everywhere / driverless)"
else
    lpadmin -p "${CANON_QUEUE}" -E -v "${CANON_URI}" -m lsb/usr/cups-included/generic-postscript.ppd 2>/dev/null || \
    lpadmin -p "${CANON_QUEUE}" -E -v "${CANON_URI}" -P /usr/share/ppd/cupsfilters/Generic-PDF_Printer-PDF.ppd
    warn "Canon registered with fallback PPD"
fi

# Enable and unpause
cupsenable "${KYOCERA_QUEUE}" 2>/dev/null || true
cupsenable "${CANON_QUEUE}"   2>/dev/null || true
cupsaccept "${KYOCERA_QUEUE}" 2>/dev/null || true
cupsaccept "${CANON_QUEUE}"   2>/dev/null || true

echo ""
info "Verifying CUPS queues..."
lpstat -p "${KYOCERA_QUEUE}" && pass "Kyocera queue active" || fail "Kyocera queue not found in lpstat"
lpstat -p "${CANON_QUEUE}"   && pass "Canon queue active"   || fail "Canon queue not found in lpstat"

# Update config file IPs
if [[ -f "${CONFIG_FILE}" ]]; then
    sed -i "s|^KYOCERA_IP=.*|KYOCERA_IP=${KYOCERA_IP}|" "${CONFIG_FILE}"
    sed -i "s|^CANON_IP=.*|CANON_IP=${CANON_IP}|"       "${CONFIG_FILE}"
    sed -i "s|^KYOCERA_QUEUE=.*|KYOCERA_QUEUE=${KYOCERA_QUEUE}|" "${CONFIG_FILE}"
    sed -i "s|^CANON_QUEUE=.*|CANON_QUEUE=${CANON_QUEUE}|"       "${CONFIG_FILE}"
    pass "Updated ${CONFIG_FILE} with printer IPs and queue names"
fi

# Optional test print
echo ""
read -rp "Send a test page to Kyocera? [y/N] " DO_KYOCERA_TEST
if [[ "${DO_KYOCERA_TEST,,}" == "y" ]]; then
    echo "Test print" | lp -d "${KYOCERA_QUEUE}" && pass "Kyocera test page sent" || warn "Kyocera test print failed"
fi

read -rp "Send a test page to Canon? [y/N] " DO_CANON_TEST
if [[ "${DO_CANON_TEST,,}" == "y" ]]; then
    echo "Test print" | lp -d "${CANON_QUEUE}" && pass "Canon test page sent" || warn "Canon test print failed"
fi

echo ""
pass "Printer configuration complete."
echo " Kyocera: ${KYOCERA_URI}"
echo " Canon:   ${CANON_URI}"
echo ""
echo " Run 'sudo bash doctor.sh' to verify the full system."

