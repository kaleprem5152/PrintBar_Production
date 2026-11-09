"""
Tests for auth.py — Canonical HMAC-SHA256 signature verification & local replay protection.
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


def test_auth_headers_canonical_format(dev_env):
    import auth
    importlib.reload(auth)
    headers = auth.get_auth_headers(b'{"test": 1}')
    assert "x-device-id" in headers
    assert "x-device-ts" in headers
    assert "x-device-nonce" in headers
    assert "x-device-token" in headers
    # Raw secret must NOT be emitted
    assert "x-agent-key" not in headers


def test_token_matches_canonical_hmac(dev_env):
    import auth
    importlib.reload(auth)
    body = b'{"hello": "world"}'
    headers = auth.get_auth_headers(body)

    device_id = headers["x-device-id"]
    ts = headers["x-device-ts"]
    nonce = headers["x-device-nonce"]
    token = headers["x-device-token"]
    secret = os.environ["DEVICE_AUTH_SECRET"].encode("utf-8")

    body_sha256 = hashlib.sha256(body).hexdigest()
    canonical_msg = f"{device_id}:{ts}:{nonce}:{body_sha256}".encode("utf-8")
    expected = hmac.new(secret, canonical_msg, hashlib.sha256).hexdigest()

    assert token == expected


def test_nonces_are_unique(dev_env):
    import auth
    importlib.reload(auth)
    nonces = {auth.get_auth_headers()["x-device-nonce"] for _ in range(25)}
    assert len(nonces) == 25


def test_validate_incoming_token(dev_env, fresh_db):
    import auth
    importlib.reload(auth)
    body = b"verify-me"
    headers = auth.get_auth_headers(body)
    # Different nonce to avoid replay check
    fresh_nonce = "fresh-test-nonce-12345"
    body_sha = hashlib.sha256(body).hexdigest()
    msg = f"{headers['x-device-id']}:{headers['x-device-ts']}:{fresh_nonce}:{body_sha}".encode("utf-8")
    secret = os.environ["DEVICE_AUTH_SECRET"].encode("utf-8")
    token = hmac.new(secret, msg, hashlib.sha256).hexdigest()

    valid = auth.validate_incoming_token(
        headers["x-device-id"],
        headers["x-device-ts"],
        fresh_nonce,
        token,
        body,
    )
    assert valid is True
