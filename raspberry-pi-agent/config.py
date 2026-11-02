# PrintBar Raspberry Pi Hardware Agent Configuration

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# Cloud Backend API
CLOUD_API_URL = os.getenv("CLOUD_API_URL", "http://localhost:3000").rstrip("/")

# Device Authentication
DEVICE_ID = os.getenv("DEVICE_ID", "PB-K01")
DEVICE_AUTH_SECRET = os.getenv("DEVICE_AUTH_SECRET", "change-this-in-production")

# Intervals (seconds)
POLL_INTERVAL_SECONDS = int(os.getenv("POLL_INTERVAL_SECONDS", "3"))
HEARTBEAT_INTERVAL_SECONDS = int(os.getenv("HEARTBEAT_INTERVAL_SECONDS", "30"))

# CUPS Queue Names
# Matches lpadmin queue names configured on the Raspberry Pi
KYOCERA_QUEUE = os.getenv("KYOCERA_QUEUE", "Kyocera_PA3500x")
CANON_QUEUE = os.getenv("CANON_QUEUE", "Canon_GX6170")

# Local Storage
BASE_DIR = Path(__file__).resolve().parent
LOCAL_DATA_DIR = Path(os.getenv("LOCAL_DATA_DIR", str(BASE_DIR / "data")))
LOCAL_DATA_DIR.mkdir(parents=True, exist_ok=True)

SQLITE_DB_PATH = LOCAL_DATA_DIR / "agent.db"
JOB_DOWNLOAD_DIR = LOCAL_DATA_DIR / "downloads"
JOB_DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
