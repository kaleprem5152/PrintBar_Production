"""
Tests for db.py — Schema v4, idempotent claims, exponential backoff, attempt tracking.
"""
import sys
import os
import pytest

AGENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if AGENT_DIR not in sys.path:
    sys.path.insert(0, AGENT_DIR)


def test_schema_v4_tables_and_columns(fresh_db):
    db = fresh_db
    with db.get_connection() as conn:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    expected = {
        "schema_version", "local_jobs", "print_attempts",
        "outbox_events", "nonces", "command_history", "printer_state_history"
    }
    assert expected.issubset(tables)


def test_idempotent_job_claim_preserves_progress(fresh_db):
    db = fresh_db
    # Initial claim
    db.record_job_claimed("ORD-IDEMP", "JR-1", "printbar-kyocera", 10, "bw", 1, {})
    db.update_job_progress("ORD-IDEMP", pages_printed=4, status="printing")

    # Re-claim should NOT reset pages_printed to 0 or status to claimed!
    db.record_job_claimed("ORD-IDEMP", "JR-1", "printbar-kyocera", 10, "bw", 1, {})
    with db.get_connection() as conn:
        row = conn.execute("SELECT status, pages_printed FROM local_jobs WHERE order_id = 'ORD-IDEMP'").fetchone()

    assert row["status"] == "printing"
    assert row["pages_printed"] == 4


def test_outbox_exponential_backoff(fresh_db):
    db = fresh_db
    ev_id = db.save_outbox_event("telemetry", None, {"sample": 1})
    db.schedule_outbox_retry(ev_id, "HTTP 500 error")

    with db.get_connection() as conn:
        row = conn.execute("SELECT retry_count, last_error, backlog_status FROM outbox_events WHERE id = ?", (ev_id,)).fetchone()

    assert row["retry_count"] == 1
    assert "HTTP 500" in row["last_error"]
    assert row["backlog_status"] == "retrying"


def test_outbox_stats(fresh_db):
    db = fresh_db
    db.save_outbox_event("req1", "O1", {})
    db.save_outbox_event("req2", "O2", {})
    stats = db.get_outbox_stats()
    assert stats["pending_events"] >= 2
    assert stats["synced_events"] >= 0


def test_print_attempt_lifecycle(fresh_db):
    db = fresh_db
    db.record_job_claimed("ORD-ATT", "JR-ATT", "printbar-kyocera", 5, "bw", 1, {})
    att_id = db.record_print_attempt("ORD-ATT", 1, "printbar-kyocera", "kyocera-99")
    db.update_print_attempt(att_id, cups_state="completed", pages_printed=5, result="completed", ended=True)

    with db.get_connection() as conn:
        row = conn.execute("SELECT cups_state, pages_printed, result FROM print_attempts WHERE id = ?", (att_id,)).fetchone()
    assert row["cups_state"] == "completed"
    assert row["pages_printed"] == 5
    assert row["result"] == "completed"
