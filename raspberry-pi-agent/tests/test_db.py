"""
Tests for db.py — SQLite WAL, schema migrations, outbox, nonces, attempts.
"""
import sys
import os
import json
import pytest
import importlib

AGENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if AGENT_DIR not in sys.path:
    sys.path.insert(0, AGENT_DIR)


def test_init_creates_all_tables(fresh_db):
    db = fresh_db
    with db.get_connection() as conn:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    expected = {
        "schema_version", "local_jobs", "print_attempts",
        "outbox_events", "nonces", "command_history", "printer_state_history"
    }
    assert expected.issubset(tables), f"Missing tables: {expected - tables}"


def test_wal_mode(fresh_db):
    db = fresh_db
    with db.get_connection() as conn:
        mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
    assert mode == "wal"


def test_foreign_keys_enabled(fresh_db):
    db = fresh_db
    with db.get_connection() as conn:
        fk = conn.execute("PRAGMA foreign_keys").fetchone()[0]
    assert fk == 1


def test_record_and_retrieve_job(fresh_db):
    db = fresh_db
    db.record_job_claimed("ORD-001", "JR-001", "printbar-kyocera", 10, "bw", 2, {"test": True})
    job = db.get_active_job()
    assert job is not None
    assert job["order_id"] == "ORD-001"
    assert job["status"] == "claimed"
    assert job["pages_to_print"] == 10


def test_update_job_progress(fresh_db):
    db = fresh_db
    db.record_job_claimed("ORD-002", "JR-002", "printbar-kyocera", 5, "bw", 1, {})
    db.update_job_progress("ORD-002", 3, cups_job_id="kyocera-45", status="printing")
    job = db.get_active_job()
    assert job["pages_printed"] == 3
    assert job["cups_job_id"] == "kyocera-45"
    assert job["status"] == "printing"


def test_mark_job_completed(fresh_db):
    db = fresh_db
    db.record_job_claimed("ORD-003", "JR-003", "printbar-kyocera", 2, "bw", 1, {})
    db.mark_job_completed("ORD-003")
    # Completed jobs not returned by get_active_job
    assert db.get_active_job() is None


def test_incomplete_jobs_returned_on_startup(fresh_db):
    db = fresh_db
    db.record_job_claimed("ORD-010", "JR-010", "printbar-kyocera", 5, "bw", 1, {})
    jobs = db.get_incomplete_jobs()
    assert any(j["order_id"] == "ORD-010" for j in jobs)


def test_outbox_save_and_retrieve(fresh_db):
    db = fresh_db
    ev_id = db.save_outbox_event("progress", "ORD-100", {"pagesPrinted": 3, "_url": "http://x", "_method": "PATCH"})
    assert ev_id > 0
    pending = db.get_pending_outbox()
    assert any(e["id"] == ev_id for e in pending)


def test_outbox_mark_synced(fresh_db):
    db = fresh_db
    ev_id = db.save_outbox_event("complete", "ORD-200", {"_url": "http://x", "_method": "POST"})
    db.mark_outbox_synced(ev_id)
    pending = db.get_pending_outbox()
    assert all(e["id"] != ev_id for e in pending)


def test_nonce_dedup(fresh_db):
    db = fresh_db
    db.save_nonce("unique-nonce-abc", "TEST-K01")
    assert db.nonce_exists("unique-nonce-abc") is True
    assert db.nonce_exists("different-nonce") is False


def test_print_attempt_lifecycle(fresh_db):
    db = fresh_db
    db.record_job_claimed("ORD-300", "JR-300", "printbar-kyocera", 4, "bw", 1, {})
    att_id = db.record_print_attempt("ORD-300", 1, "printbar-kyocera", "kyocera-77")
    assert att_id > 0
    db.update_print_attempt(att_id, cups_state="processing", pages_printed=2, result="completed", ended=True)
    with db.get_connection() as conn:
        row = conn.execute("SELECT * FROM print_attempts WHERE id=?", (att_id,)).fetchone()
    assert row["cups_state"] == "processing"
    assert row["pages_printed"] == 2


def test_command_idempotency(fresh_db):
    db = fresh_db
    db.record_command("CMD-001", "test_print")
    assert db.command_already_executed("CMD-001") is False  # still pending
    db.complete_command("CMD-001", "succeeded", {"result": "ok"})
    assert db.command_already_executed("CMD-001") is True


def test_printer_state_history(fresh_db):
    db = fresh_db
    db.record_printer_state("kyocera", "READY", "cups", {"cups_state": "idle"})
    with db.get_connection() as conn:
        rows = conn.execute("SELECT * FROM printer_state_history").fetchall()
    assert len(rows) == 1
    assert rows[0]["state"] == "READY"

