"""
PrintBar Raspberry Pi Hardware Agent — Production Configuration.
All settings are driven by environment variables. No hardcoded secrets or IPs.
Production mode enforces strict validation — refuses to start with defaults or missing values.
"""

import os
import sys
import logging
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("printbar.config")

# ---------------------------------------------------------------------------
# Cloud Backend
# ---------------------------------------------------------------------------
CLOUD_API_URL = os.getenv("CLOUD_API_URL", "").rstrip("/")

# ---------------------------------------------------------------------------
# Device Identity & Authentication
# ---------------------------------------------------------------------------
DEVICE_ID = os.getenv("DEVICE_ID", "PB-K01")
DEVICE_AUTH_SECRET = os.getenv("DEVICE_AUTH_SECRET") or os.getenv("PRINTBAR_DEVICE_SECRET") or os.getenv("KIOSK_AGENT_SECRET") or ""

# ---------------------------------------------------------------------------
# Printer Network Configuration
# ---------------------------------------------------------------------------
KYOCERA_IP    = os.getenv("KYOCERA_IP", "")
CANON_IP      = os.getenv("CANON_IP", "")
KYOCERA_PORT  = int(os.getenv("KYOCERA_PORT", "9100"))
CANON_PORT    = int(os.getenv("CANON_PORT", "9100"))

# CUPS queue names (must match lpadmin -p <name>)
KYOCERA_QUEUE = os.getenv("KYOCERA_QUEUE", "printbar-kyocera")
CANON_QUEUE   = os.getenv("CANON_QUEUE", "printbar-canon")

# ---------------------------------------------------------------------------
# Polling & Timing
# ---------------------------------------------------------------------------
POLL_INTERVAL_SECONDS      = int(os.getenv("POLL_INTERVAL_SECONDS", "3"))
HEARTBEAT_INTERVAL_SECONDS = int(os.getenv("HEARTBEAT_INTERVAL_SECONDS", "30"))
COMMAND_POLL_INTERVAL      = int(os.getenv("COMMAND_POLL_INTERVAL", "10"))

# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------
BASE_DIR              = Path(__file__).resolve().parent
DOCUMENT_STORAGE_DIR  = Path(os.getenv("DOCUMENT_STORAGE_DIR", str(BASE_DIR / "data" / "jobs")))
LOCAL_DATA_DIR        = Path(os.getenv("LOCAL_DATA_DIR", str(BASE_DIR / "data")))
SQLITE_DB_PATH        = LOCAL_DATA_DIR / "agent.db"
JOB_DOWNLOAD_DIR      = DOCUMENT_STORAGE_DIR   # alias for compatibility

# Create directories on import (safe — idempotent)
LOCAL_DATA_DIR.mkdir(parents=True, exist_ok=True)
DOCUMENT_STORAGE_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Kiosk Display
# ---------------------------------------------------------------------------
KIOSK_URL = os.getenv("KIOSK_URL", "")

# ---------------------------------------------------------------------------
# Operation Mode
# ---------------------------------------------------------------------------
PRODUCTION_MODE = os.getenv("PRODUCTION_MODE", "false").lower() in ("true", "1", "yes")
LOG_LEVEL       = os.getenv("LOG_LEVEL", "INFO").upper()

# ---------------------------------------------------------------------------
# Known weak / placeholder secret patterns
# ---------------------------------------------------------------------------
_WEAK_SECRETS = {
    "", "change-this-in-production", "demo", "secret", "changeme",
    "your-secret-here", "placeholder", "test", "development",
}

def validate_config() -> None:
    """
    Validate all required configuration values.
    In PRODUCTION_MODE=true: raises SystemExit(1) on any missing/weak value.
    In dev mode: logs warnings only.
    """
    errors: list = []
    warnings: list = []

    # --- Cloud URL ---
    if not CLOUD_API_URL:
        errors.append("CLOUD_API_URL is not set.")
    elif PRODUCTION_MODE and ("localhost" in CLOUD_API_URL or "127.0.0.1" in CLOUD_API_URL):
        errors.append(f"CLOUD_API_URL points to localhost in production mode: {CLOUD_API_URL}")

    # --- Auth secret ---
    if not DEVICE_AUTH_SECRET:
        errors.append("DEVICE_AUTH_SECRET is not set.")
    elif DEVICE_AUTH_SECRET.lower() in _WEAK_SECRETS:
        errors.append("DEVICE_AUTH_SECRET is a known weak/placeholder value. Generate with: openssl rand -hex 32")

    # --- Printer IPs ---
    if PRODUCTION_MODE:
        if not KYOCERA_IP:
            errors.append("KYOCERA_IP is not set. Required in production mode.")
        if not CANON_IP:
            errors.append("CANON_IP is not set. Required in production mode.")
    else:
        if not KYOCERA_IP:
            warnings.append("KYOCERA_IP not set — printer routing will use queue names only.")
        if not CANON_IP:
            warnings.append("CANON_IP not set — printer routing will use queue names only.")

    # --- Kiosk URL ---
    if PRODUCTION_MODE and not KIOSK_URL:
        warnings.append("KIOSK_URL is not set — kiosk display service will not launch browser.")

    # Emit
    for w in warnings:
        logger.warning("[CONFIG WARNING] %s", w)

    if errors:
        for e in errors:
            logger.critical("[CONFIG ERROR] %s", e)
        if PRODUCTION_MODE:
            logger.critical("PRODUCTION_MODE=true: refusing to start with invalid configuration.")
            sys.exit(1)
        else:
            logger.warning("Dev mode: continuing despite config errors (would fail in production).")
