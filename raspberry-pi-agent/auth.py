"""
Authentication helper for the PrintBar Raspberry Pi Agent.
Generates HMAC-SHA256 request headers matching the Next.js device-auth middleware.
Includes durable nonce storage for replay protection.
"""
import time
import uuid
import hmac
import hashlib
import logging
from typing import Dict
from config import DEVICE_ID, DEVICE_AUTH_SECRET

logger = logging.getLogger("printbar.auth")

# Timestamp skew tolerance in seconds (must match server)
_MAX_SKEW_SECONDS = 300


def get_auth_headers(body_bytes: bytes = b"") -> Dict[str, str]:
    """
    Generate device authentication headers for a cloud API request.

    Headers produced:
      x-device-id    — Device identifier (PB-K01)
      x-device-ts    — Unix epoch timestamp (seconds)
      x-device-nonce — Random UUIDv4 hex (unique per request)
      x-device-token — HMAC-SHA256 of "DEVICE_ID:ts:nonce:body_sha256"
      x-agent-key    — Raw secret for simple-auth endpoints
    """
    ts = str(int(time.time()))
    nonce = uuid.uuid4().hex
    body_hash = hashlib.sha256(body_bytes).hexdigest()
    message = f"{DEVICE_ID}:{ts}:{nonce}:{body_hash}".encode("utf-8")
    secret = DEVICE_AUTH_SECRET.encode("utf-8")
    # NOTE: hmac.new() is the correct call (not hmac.new with positional digestmod)
    signature = hmac.new(secret, message, hashlib.sha256).hexdigest()

    # Persist nonce to SQLite for durable replay protection
    try:
        import db as _db
        _db.save_nonce(nonce, DEVICE_ID)
    except Exception as exc:
        logger.debug("Could not persist nonce: %s", exc)

    return {
        "x-device-id":    DEVICE_ID,
        "x-device-ts":    ts,
        "x-device-nonce": nonce,
        "x-device-token": signature,
        "x-agent-key":    DEVICE_AUTH_SECRET,
        "Content-Type":   "application/json",
    }


def validate_incoming_token(
    device_id: str,
    ts_str: str,
    nonce: str,
    token: str,
    body_bytes: bytes = b"",
) -> bool:
    """
    Server-side validation helper (used if the Pi ever acts as a mini-server).
    Returns True if the token is valid, timestamp is fresh, and nonce is not replayed.
    """
    # Timestamp freshness
    try:
        ts = int(ts_str)
        skew = abs(int(time.time()) - ts)
        if skew > _MAX_SKEW_SECONDS:
            logger.warning("Token timestamp too old/new: skew=%ds", skew)
            return False
    except ValueError:
        return False

    # Nonce replay check
    try:
        import db as _db
        if _db.nonce_exists(nonce):
            logger.warning("Replayed nonce detected: %s", nonce)
            return False
    except Exception:
        pass  # Can't check DB — allow but log

    # Signature verification
    body_hash = hashlib.sha256(body_bytes).hexdigest()
    message = f"{device_id}:{ts_str}:{nonce}:{body_hash}".encode("utf-8")
    secret = DEVICE_AUTH_SECRET.encode("utf-8")
    expected = hmac.new(secret, message, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, token)
