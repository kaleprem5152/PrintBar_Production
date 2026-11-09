"""
Shared pytest fixtures for PrintBar agent tests.
"""
import os
import sys
import tempfile
import pytest

# Ensure the agent directory is importable
AGENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if AGENT_DIR not in sys.path:
    sys.path.insert(0, AGENT_DIR)


@pytest.fixture(autouse=True)
def dev_env(monkeypatch, tmp_path):
    """Force dev-mode environment and isolated storage for all tests."""
    monkeypatch.setenv("PRODUCTION_MODE", "false")
    monkeypatch.setenv("CLOUD_API_URL", "http://localhost:9999")
    monkeypatch.setenv("DEVICE_ID", "TEST-K01")
    monkeypatch.setenv("DEVICE_AUTH_SECRET", "test-secret-at-least-32-chars-long!!")
    monkeypatch.setenv("KYOCERA_IP", "192.168.1.101")
    monkeypatch.setenv("CANON_IP", "192.168.1.102")
    monkeypatch.setenv("KYOCERA_QUEUE", "printbar-kyocera")
    monkeypatch.setenv("CANON_QUEUE", "printbar-canon")
    monkeypatch.setenv("LOCAL_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("DOCUMENT_STORAGE_DIR", str(tmp_path / "jobs"))
    (tmp_path / "jobs").mkdir(exist_ok=True)
    yield tmp_path


@pytest.fixture
def db_path(dev_env):
    """Return an isolated SQLite DB path."""
    return dev_env / "agent.db"


@pytest.fixture
def fresh_db(db_path, monkeypatch):
    """Initialise a fresh in-test database."""
    monkeypatch.setenv("LOCAL_DATA_DIR", str(db_path.parent))
    # Re-import config to pick up patched env
    import importlib
    import config as cfg
    importlib.reload(cfg)
    import db
    importlib.reload(db)
    db.SQLITE_DB_PATH = db_path
    db.init_db()
    return db

