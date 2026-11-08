"""
Authentication helper for the PrintBar Raspberry Pi Agent.
Generates HMAC-SHA256 headers matching the Next.js server-side device-auth.ts.
Includes unique nonce per request for cryptographic replay protection.
"""
import time
import uuid
import hmac
import hashlib
from typing import Dict
from config import DEVICE_ID, DEVICE_AUTH_SECRET

def get_auth_headers() -> Dict[str, str]:
    """
    Generate device authentication headers:
    - x-device-id:    Device ID (e.g. PB-K01)
    - x-device-ts:    Unix epoch timestamp in seconds
    - x-device-nonce: Random UUIDv4 hex string
    - x-device-token: HMAC-SHA256(DEVICE_ID + ":" + timestamp + ":" + nonce, DEVICE_AUTH_SECRET)
    """
    ts = str(int(time.time()))
    nonce = uuid.uuid4().hex
    message = f"{DEVICE_ID}:{ts}:{nonce}".encode("utf-8")
    secret = DEVICE_AUTH_SECRET.encode("utf-8")
    signature = hmac.new(secret, message, hashlib.sha256).hexdigest()

    return {
        "x-device-id": DEVICE_ID,
        "x-device-ts": ts,
        "x-device-nonce": nonce,
        "x-device-token": signature,
    }
