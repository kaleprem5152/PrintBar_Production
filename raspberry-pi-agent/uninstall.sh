#!/usr/bin/env bash
# ==============================================================================
# PrintBar Agent Uninstaller
# Stops services, removes /opt/printbar, /etc/printbar, /etc/sudoers.d/printbar
# Optionally preserves /var/lib/printbar (job history & DB)
# ==============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
pass() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

[[ $EUID -ne 0 ]] && { echo -e "${RED}Must run as root${NC}"; exit 1; }

echo ""
echo "============================================================"
echo "   PrintBar Agent Uninstaller"
echo "============================================================"
echo ""
read -rp "Remove ALL PrintBar files including job history? [y/N] " CONFIRM_ALL

systemctl stop printbar-agent 2>/dev/null || true
systemctl stop printbar-kiosk 2>/dev/null || true
systemctl disable printbar-agent 2>/dev/null || true
systemctl disable printbar-kiosk 2>/dev/null || true
pass "Services stopped and disabled"

rm -f /etc/systemd/system/printbar-agent.service
rm -f /etc/systemd/system/printbar-kiosk.service
systemctl daemon-reload
pass "Systemd units removed"

rm -rf /opt/printbar
pass "Removed /opt/printbar"

rm -rf /etc/printbar
pass "Removed /etc/printbar (config)"

rm -f /etc/sudoers.d/printbar
pass "Removed sudoers rules"

if [[ "${CONFIRM_ALL,,}" == "y" ]]; then
    rm -rf /var/lib/printbar
    rm -rf /var/log/printbar
    pass "Removed /var/lib/printbar (job data) and /var/log/printbar"
else
    warn "Preserved /var/lib/printbar (job data). Delete manually if needed."
fi

pass "Uninstall complete."

