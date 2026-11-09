"""
Authentication helper for the PrintBar Raspberry Pi Agent.
Generates canonical HMAC-SHA256 request headers matching Next.js device-auth.
Canonical message format: f"{DEVICE_ID}:{timestamp}:{nonce}:{body_sha256}"

All raw secrets (x-agent-key) are completely eliminated.
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

# Timestamp skew tolerance in seconds
_MAX_SKEW_SECONDS = 120


def get_auth_headers(body_bytes: bytes = b"") -> Dict[str, str]:
    """
    Generate device authentication headers for a cloud API request.

    Canonical signature contract:
      x-device-id    — Device identifier (e.g. PB-K01)
      x-device-ts    — Unix epoch timestamp (seconds)
      x-device-nonce — Random UUIDv4 hex (unique per request)
      x-device-token — HMAC-SHA256 of "DEVICE_ID:ts:nonce:body_sha256"
    """
    ts = str(int(time.time()))
    nonce = uuid.uuid4().hex
    body_hash = hashlib.sha256(body_bytes).hexdigest()
    message = f"{DEVICE_ID}:{ts}:{nonce}:{body_hash}".encode("utf-8")
    secret = DEVICE_AUTH_SECRET.encode("utf-8")
    signature = hmac.new(secret, message, hashlib.sha256).hexdigest()

    # Persist nonce to SQLite for local replay protection
    try:
        import db as _db
        _db.save_nonce(nonce, DEVICE_ID)
    except Exception as exc:
        logger.debug("Could not persist nonce locally: %s", exc)

    return {
        "x-device-id":    DEVICE_ID,
        "x-device-ts":    ts,
        "x-device-nonce": nonce,
        "x-device-token": signature,
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
    Validation helper verifying the canonical HMAC signature.
    Returns True if the token is valid, timestamp is fresh, and nonce is not replayed.
    """
    try:
        ts = int(ts_str)
        skew = abs(int(time.time()) - ts)
        if skew > _MAX_SKEW_SECONDS:
            logger.warning("Token timestamp expired: skew=%ds", skew)
            return False
    except ValueError:
        return False

    try:
        import db as _db
        if _db.nonce_exists(nonce):
            logger.warning("Replayed nonce detected: %s", nonce)
            return False
    except Exception:
        pass

    body_hash = hashlib.sha256(body_bytes).hexdigest()
    message = f"{device_id}:{ts_str}:{nonce}:{body_hash}".encode("utf-8")
    secret = DEVICE_AUTH_SECRET.encode("utf-8")
    expected = hmac.new(secret, message, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, token)
