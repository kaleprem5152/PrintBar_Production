"""
Authentication helper for the PrintBar Raspberry Pi Agent.
Generates canonical HMAC-SHA256 request headers matching Next.js device-auth.

Canonical signature serialization:
  f"{METHOD.upper()}:{NORMALIZED_PATH}:{TIMESTAMP}:{NONCE}:{BODY_SHA256}"

Headers emitted:
  X-Device-ID:   Device identifier (e.g. PB-K01)
  X-Timestamp:   Unix epoch in seconds
  X-Nonce:       Random UUIDv4 hex string
  X-Signature:   HMAC-SHA256 hex string

No raw long-lived secrets are ever transmitted in request headers.
"""
import time
import uuid
import hmac
import hashlib
import logging
from typing import Dict, Optional
from urllib.parse import urlparse
from config import DEVICE_ID, DEVICE_AUTH_SECRET

logger = logging.getLogger("printbar.auth")

_MAX_SKEW_SECONDS = 120
_EMPTY_SHA256 = hashlib.sha256(b"").hexdigest()


def normalize_canonical_path(url_or_path: str) -> str:
    """Extract and normalize path without query strings or trailing slashes."""
    try:
        if "://" in url_or_path:
            parsed = urlparse(url_or_path)
            path = parsed.path
        else:
            path = url_or_path.split("?")[0].split("#")[0]
        # Normalize slashes
        path = "/" + "/".join(part for part in path.split("/") if part)
        return path if path != "/" else ""
    except Exception:
        return url_or_path


def build_canonical_message(
    method: str,
    path: str,
    timestamp: str,
    nonce: str,
    body_sha256: str,
) -> str:
    norm_method = method.strip().upper()
    norm_path = normalize_canonical_path(path)
    norm_sha = body_sha256.strip().lower()
    return f"{norm_method}:{norm_path}:{timestamp}:{nonce}:{norm_sha}"


def get_auth_headers(
    body_bytes: bytes = b"",
    method: str = "POST",
    path: str = "",
) -> Dict[str, str]:
    """
    Generate device authentication headers according to the canonical V4 specification.
    """
    ts = str(int(time.time()))
    nonce = uuid.uuid4().hex

    body_sha256 = hashlib.sha256(body_bytes).hexdigest() if body_bytes else _EMPTY_SHA256
    canonical_msg = build_canonical_message(method, path, ts, nonce, body_sha256).encode("utf-8")

    secret = DEVICE_AUTH_SECRET.encode("utf-8")
    signature = hmac.new(secret, canonical_msg, hashlib.sha256).hexdigest()

    # Save nonce locally to prevent accidental re-submission
    try:
        import db as _db
        _db.save_nonce(nonce, DEVICE_ID)
    except Exception as exc:
        logger.debug("Could not persist nonce locally: %s", exc)

    return {
        "X-Device-ID":  DEVICE_ID,
        "X-Timestamp":  ts,
        "X-Nonce":      nonce,
        "X-Signature":  signature,
        "Content-Type": "application/json",
    }


def validate_incoming_token(*args, **kwargs) -> bool:
    """
    Local validation helper matching the server contract.
    Canonical signature: METHOD:PATH:TIMESTAMP:NONCE:BODY_SHA256
    Supports:
      validate_incoming_token(method, path, device_id, ts_str, nonce, token, body_bytes=b"")
      validate_incoming_token(device_id, ts_str, nonce, token, body_bytes=b"") [defaults method='POST', path='']
    """
    if len(args) == 5:
        method = "POST"
        path = ""
        device_id, ts_str, nonce, token, body_bytes = args
    elif len(args) >= 6:
        method, path, device_id, ts_str, nonce, token = args[:6]
        body_bytes = args[6] if len(args) > 6 else b""
    else:
        method = kwargs.get("method", "POST")
        path = kwargs.get("path", "")
        device_id = kwargs.get("device_id", "")
        ts_str = str(kwargs.get("ts_str") or kwargs.get("timestamp_str", ""))
        nonce = kwargs.get("nonce", "")
        token = kwargs.get("token", "")
        body_bytes = kwargs.get("body_bytes", b"")

    try:
        ts = int(ts_str)
        skew = abs(int(time.time()) - ts)
        if skew > _MAX_SKEW_SECONDS:
            logger.warning("Token timestamp expired: skew=%ds", skew)
            return False
    except (ValueError, TypeError):
        return False

    try:
        import db as _db
        if _db.nonce_exists(nonce):
            logger.warning("Replayed nonce detected: %s", nonce)
            return False
    except Exception:
        pass

    body_sha = hashlib.sha256(body_bytes).hexdigest() if body_bytes else _EMPTY_SHA256
    canonical_msg = build_canonical_message(method, path, str(ts_str), nonce, body_sha).encode("utf-8")
    secret = DEVICE_AUTH_SECRET.encode("utf-8")
    expected = hmac.new(secret, canonical_msg, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, token)
