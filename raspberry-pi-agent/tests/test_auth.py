"""
Tests for auth.py — Canonical HMAC-SHA256 signature verification & local replay protection.
Includes shared test vectors verified against TypeScript backend authenticator.
"""
import sys
import os
import hmac
import hashlib
import importlib

AGENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if AGENT_DIR not in sys.path:
    sys.path.insert(0, AGENT_DIR)


def test_exact_shared_vector_matches_typescript(dev_env):
    """
    Verifies that Python and TypeScript generate byte-for-byte identical HMAC signatures
    for the exact same inputs according to the canonical specification.
    """
    import auth
    importlib.reload(auth)

    secret = b"shared-test-secret-printbar-2026-xyz"
    method = "POST"
    path = "/api/device/jobs/PB-2026-00042?action=complete"
    ts = "1762700000"
    nonce = "testnonce1234567890abcdef"
    body = b'{"pagesPrinted":10,"status":"completed"}'
    expected_sig = "23aad655898c3de53600511760ff15208d7d8a46150205d29e2fa0420161ba59"

    body_sha = hashlib.sha256(body).hexdigest()
    canonical_msg = auth.build_canonical_message(method, path, ts, nonce, body_sha).encode("utf-8")
    sig = hmac.new(secret, canonical_msg, hashlib.sha256).hexdigest()

    assert sig == expected_sig


def test_auth_headers_canonical_format(dev_env):
    import auth
    importlib.reload(auth)
    headers = auth.get_auth_headers(b'{"test": 1}', method="POST", path="/api/device/jobs")
    assert "X-Device-ID" in headers
    assert "X-Timestamp" in headers
    assert "X-Nonce" in headers
    assert "X-Signature" in headers
    # Raw secret must NOT be emitted
    assert "x-agent-key" not in headers


def test_token_matches_canonical_hmac(dev_env):
    import auth
    importlib.reload(auth)
    body = b'{"hello": "world"}'
    headers = auth.get_auth_headers(body, method="POST", path="/api/device/jobs")

    device_id = headers["X-Device-ID"]
    ts = headers["X-Timestamp"]
    nonce = headers["X-Nonce"]
    sig = headers["X-Signature"]
    secret = os.environ["DEVICE_AUTH_SECRET"].encode("utf-8")

    body_sha256 = hashlib.sha256(body).hexdigest()
    canonical_msg = auth.build_canonical_message("POST", "/api/device/jobs", ts, nonce, body_sha256).encode("utf-8")
    expected = hmac.new(secret, canonical_msg, hashlib.sha256).hexdigest()

    assert device_id == os.environ["DEVICE_ID"]
    assert sig == expected


def test_nonces_are_unique(dev_env):
    import auth
    importlib.reload(auth)
    nonces = {auth.get_auth_headers()["X-Nonce"] for _ in range(25)}
    assert len(nonces) == 25


def test_validate_incoming_token(dev_env, fresh_db):
    import auth
    importlib.reload(auth)
    body = b"verify-me"
    headers = auth.get_auth_headers(body)
    fresh_nonce = "fresh-test-nonce-12345"
    body_sha = hashlib.sha256(body).hexdigest()
    msg = auth.build_canonical_message("POST", "", headers["X-Timestamp"], fresh_nonce, body_sha).encode("utf-8")
    secret = os.environ["DEVICE_AUTH_SECRET"].encode("utf-8")
    token = hmac.new(secret, msg, hashlib.sha256).hexdigest()

    valid = auth.validate_incoming_token(
        headers["X-Device-ID"],
        headers["X-Timestamp"],
        fresh_nonce,
        token,
        body,
    )
    assert valid is True
