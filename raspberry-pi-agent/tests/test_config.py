"""
Tests for config.py — validation logic.
"""
import sys
import os
import pytest
import importlib


def reload_config():
    if "config" in sys.modules:
        del sys.modules["config"]
    import config
    return config


def test_validates_ok(monkeypatch):
    """Should not raise or exit with valid config."""
    monkeypatch.setenv("PRODUCTION_MODE", "false")
    monkeypatch.setenv("CLOUD_API_URL", "https://printbarproduction.up.railway.app")
    monkeypatch.setenv("DEVICE_AUTH_SECRET", "a" * 64)
    monkeypatch.setenv("KYOCERA_IP", "192.168.1.101")
    monkeypatch.setenv("CANON_IP", "192.168.1.102")
    cfg = reload_config()
    # Should not raise
    cfg.validate_config()


def test_missing_cloud_url_in_production_exits(monkeypatch):
    """Missing CLOUD_API_URL must trigger SystemExit in production mode."""
    monkeypatch.setenv("PRODUCTION_MODE", "true")
    monkeypatch.setenv("CLOUD_API_URL", "")
    monkeypatch.setenv("DEVICE_AUTH_SECRET", "a" * 64)
    monkeypatch.setenv("KYOCERA_IP", "192.168.1.101")
    monkeypatch.setenv("CANON_IP", "192.168.1.102")
    cfg = reload_config()
    with pytest.raises(SystemExit):
        cfg.validate_config()


def test_weak_secret_exits_in_production(monkeypatch):
    """Weak DEVICE_AUTH_SECRET must trigger SystemExit in production mode."""
    monkeypatch.setenv("PRODUCTION_MODE", "true")
    monkeypatch.setenv("CLOUD_API_URL", "https://example.com")
    monkeypatch.setenv("DEVICE_AUTH_SECRET", "change-this-in-production")
    monkeypatch.setenv("KYOCERA_IP", "192.168.1.101")
    monkeypatch.setenv("CANON_IP", "192.168.1.102")
    cfg = reload_config()
    with pytest.raises(SystemExit):
        cfg.validate_config()


def test_missing_printer_ips_exit_in_production(monkeypatch):
    """Missing printer IPs must trigger SystemExit in production mode."""
    monkeypatch.setenv("PRODUCTION_MODE", "true")
    monkeypatch.setenv("CLOUD_API_URL", "https://example.com")
    monkeypatch.setenv("DEVICE_AUTH_SECRET", "a" * 64)
    monkeypatch.setenv("KYOCERA_IP", "")
    monkeypatch.setenv("CANON_IP", "")
    cfg = reload_config()
    with pytest.raises(SystemExit):
        cfg.validate_config()


def test_localhost_cloud_url_exits_in_production(monkeypatch):
    """localhost CLOUD_API_URL must fail in production mode."""
    monkeypatch.setenv("PRODUCTION_MODE", "true")
    monkeypatch.setenv("CLOUD_API_URL", "http://localhost:3000")
    monkeypatch.setenv("DEVICE_AUTH_SECRET", "a" * 64)
    monkeypatch.setenv("KYOCERA_IP", "192.168.1.101")
    monkeypatch.setenv("CANON_IP", "192.168.1.102")
    cfg = reload_config()
    with pytest.raises(SystemExit):
        cfg.validate_config()


def test_dev_mode_ignores_weak_secret(monkeypatch, capsys):
    """Dev mode should warn but not exit on weak secret."""
    monkeypatch.setenv("PRODUCTION_MODE", "false")
    monkeypatch.setenv("CLOUD_API_URL", "https://example.com")
    monkeypatch.setenv("DEVICE_AUTH_SECRET", "change-this-in-production")
    monkeypatch.setenv("KYOCERA_IP", "192.168.1.101")
    monkeypatch.setenv("CANON_IP", "192.168.1.102")
    cfg = reload_config()
    # Should not raise
    cfg.validate_config()

