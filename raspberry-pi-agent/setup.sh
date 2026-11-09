#!/usr/bin/env bash
# ==============================================================================
# PrintBar Setup Entry Point -> Delegating to Production install.sh
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "Redirecting to production installer: ${SCRIPT_DIR}/install.sh"
exec bash "${SCRIPT_DIR}/install.sh" "$@"
