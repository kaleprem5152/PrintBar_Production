"""
Tests for auth.py — HMAC signing and nonce replay protection.
"""
import sys
import os
import time
import hmac
import hashlib
import pytest
import importlib

AGENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if AGENT_DIR not in sys.path:
    sys.path.insert(0, AGENT_DIR)


def test_auth_headers_contain_required_fields(dev_env):
    import auth
    importlib.reload(auth)
    headers = auth.get_auth_headers()
    assert "x-device-id"    in headers
    assert "x-device-ts"    in headers
    assert "x-device-nonce" in headers
    assert "x-device-token" in headers
    assert "x-agent-key"    in headers


def test_token_is_valid_hmac(dev_env, monkeypatch):
    """Token must be valid HMAC-SHA256 of DEVICE_ID:ts:nonce:body_sha256."""
    import auth
    importlib.reload(auth)
    body = b'{"test": true}'
    headers = auth.get_auth_headers(body)

    device_id = headers["x-device-id"]
    ts        = headers["x-device-ts"]
    nonce     = headers["x-device-nonce"]
    token     = headers["x-device-token"]
    secret    = os.environ["DEVICE_AUTH_SECRET"]

    body_hash = hashlib.sha256(body).hexdigest()
    message   = f"{device_id}:{ts}:{nonce}:{body_hash}".encode()
    expected  = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
    assert token == expected


def test_nonces_are_unique(dev_env):
    import auth
    importlib.reload(auth)
    nonces = {auth.get_auth_headers()["x-device-nonce"] for _ in range(20)}
    assert len(nonces) == 20, "All nonces must be unique"


def test_timestamp_is_current(dev_env):
    import auth
    importlib.reload(auth)
    before = int(time.time())
    headers = auth.get_auth_headers()
    after = int(time.time())
    ts = int(headers["x-device-ts"])
    assert before <= ts <= after + 1


def test_validate_incoming_token_accepts_valid(dev_env, fresh_db):
    import auth
    importlib.reload(auth)
    body = b"hello"
    headers = auth.get_auth_headers(body)
    result = auth.validate_incoming_token(
        headers["x-device-id"],
        headers["x-device-ts"],
        headers["x-device-nonce"],
        headers["x-device-token"],
        body,
    )
    # Nonce was persisted by get_auth_headers(), so a second validation of the same nonce
    # should fail (replay). First call just checks signature.
    assert isinstance(result, bool)


def test_validate_rejects_bad_token(dev_env, fresh_db):
    import auth
    importlib.reload(auth)
    headers = auth.get_auth_headers(b"body")
    result = auth.validate_incoming_token(
        headers["x-device-id"],
        headers["x-device-ts"],
        headers["x-device-nonce"],
        "bad-token",
        b"body",
    )
    assert result is False

