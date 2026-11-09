#!/usr/bin/env bash
# ==============================================================================
# PrintBar Agent Upgrade Script
# Pulls latest code, reinstalls deps, restarts service.
# NEVER overwrites /etc/printbar/printbar.env (secrets safe).
# ==============================================================================
set -euo pipefail

AGENT_DIR="/opt/printbar/agent"
VENV_DIR="/opt/printbar/venv"
CONFIG_FILE="/etc/printbar/printbar.env"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
pass() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

[[ $EUID -ne 0 ]] && fail "Must be run as root: sudo bash upgrade.sh"

echo ""
echo "============================================================"
echo "   PrintBar Agent Upgrade"
echo "============================================================"

# 1. Stop service
echo "Stopping printbar-agent..."
systemctl stop printbar-agent || true

# 2. Copy new files from local source (assumes upgrade.sh is next to agent files)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for f in agent.py config.py auth.py db.py cups_manager.py printer_monitor.py requirements.txt; do
    if [[ -f "${SCRIPT_DIR}/${f}" ]]; then
        cp -f "${SCRIPT_DIR}/${f}" "${AGENT_DIR}/${f}"
        pass "Updated: ${f}"
    else
        warn "Not found in source: ${f} — skipping"
    fi
done

# 3. Update dependencies
"${VENV_DIR}/bin/pip" install --upgrade pip --quiet
"${VENV_DIR}/bin/pip" install -r "${AGENT_DIR}/requirements.txt" --quiet
pass "Dependencies updated"

# 4. Verify config still present (never overwrite)
if [[ -f "${CONFIG_FILE}" ]]; then
    pass "Config preserved: ${CONFIG_FILE}"
else
    warn "Config file missing: ${CONFIG_FILE} — run install.sh to recreate"
fi

# 5. Verify Python compilation
for f in agent.py config.py auth.py db.py cups_manager.py printer_monitor.py; do
    "${VENV_DIR}/bin/python" -m py_compile "${AGENT_DIR}/${f}" || fail "Syntax error in ${f} — upgrade aborted"
done
pass "All Python files compile OK"

# 6. Restart
systemctl daemon-reload
systemctl start printbar-agent
sleep 2
if systemctl is-active --quiet printbar-agent; then
    pass "printbar-agent restarted successfully"
else
    fail "printbar-agent failed to start — check: journalctl -u printbar-agent -n 50"
fi

echo ""
pass "Upgrade complete."
echo " Run 'sudo bash doctor.sh' to verify."

