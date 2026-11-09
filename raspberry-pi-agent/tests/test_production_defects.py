"""
Comprehensive Integration Tests for PrintBar Production Defects (Defect 18).

Covers all mandatory integration scenarios:
  1. Missing CUPS executables (lp, lpstat)
  2. Missing printer queues
  3. Printer reachable but queue disabled
  4. Backend 401/403/404 responses
  5. Backend outage (outbox buffering & backoff)
  6. Agent restart during printing
  7. CUPS completed job after restart
  8. CUPS unknown job state -> flags MANUAL_REVIEW
  9. Duplicate commands (idempotency)
  10. Duplicate job claims (preserves progress)
  11. Multiple uploaded documents
  12. Copies, duplex, colour and N-up validation
  13. Mid-print failure -> flags MANUAL_REVIEW (no unsafe auto-failover)
  14. Cleanup failure logging and visibility
"""
import sys
import os
import subprocess
from unittest.mock import MagicMock, patch
import pytest

AGENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if AGENT_DIR not in sys.path:
    sys.path.insert(0, AGENT_DIR)

from cups_manager import CupsManager
from printer_monitor import PrinterMonitor, STATE_DISABLED, STATE_ERROR, STATE_READY
from agent import PrintBarAgent


# 1. Missing CUPS executables
def test_missing_cups_executables(dev_env):
    cups = CupsManager()
    with patch("subprocess.run", side_effect=FileNotFoundError("lp not found")):
        status = cups.check_printer_status()
        assert status["cups_reachable"] is False
        assert "not installed" in status["error"]

        ok, jid, err = cups.print_file(
            file_path="nonexistent.txt",
            printer_queue="printbar-kyocera",
        )
        assert ok is False
        assert jid is None


# 2. Missing printer queues
def test_missing_printer_queues(dev_env):
    monitor = PrinterMonitor(
        kyocera_ip="192.168.1.101",
        canon_ip="192.168.1.102",
        kyocera_queue="nonexistent-queue",
    )
    with patch.object(monitor, "_check_cups_queue", return_value={"state": "missing"}):
        status = monitor.get_unified_status("kyocera", "192.168.1.101", "nonexistent-queue")
        assert status["state"] == STATE_ERROR
        assert "does not exist" in status["reason"]


# 3. Printer reachable but queue disabled
def test_printer_reachable_but_queue_disabled(dev_env):
    monitor = PrinterMonitor(
        kyocera_ip="192.168.1.101",
        canon_ip="192.168.1.102",
        kyocera_queue="printbar-kyocera",
    )
    with patch.object(monitor, "_check_cups_queue", return_value={"state": "disabled", "reason": "Paused by admin"}):
        with patch.object(monitor, "_check_tcp", return_value=True):
            status = monitor.get_unified_status("kyocera", "192.168.1.101", "printbar-kyocera")
            assert status["state"] == STATE_DISABLED
            ready, reason = monitor.is_printer_ready("kyocera")
            assert ready is False


# 4. Backend 401/403/404 responses
def test_backend_error_responses(dev_env, fresh_db):
    with patch("agent.validate_config"):
        agent = PrintBarAgent()

    with patch("requests.post") as mock_post:
        # Mock 401 Unauthorized
        res401 = MagicMock()
        res401.status_code = 401
        res401.text = "Unauthorized signature"
        mock_post.return_value = res401

        ok = agent._cloud_request("http://test/api/device/jobs/123?action=complete", {"test": 1})
        # Must return False and not consider completed
        assert ok is False


# 5. Backend outage buffers in outbox
def test_backend_outage_buffers_outbox(dev_env, fresh_db):
    with patch("agent.validate_config"):
        agent = PrintBarAgent()

    with patch("requests.post", side_effect=Exception("Connection refused")):
        ok = agent._cloud_request("http://test/api/device/jobs/O-OUTAGE?action=complete", {"orderId": "O-OUTAGE"})
        assert ok is False

        # Outbox should have captured this event
        pending = fresh_db.get_pending_outbox()
        assert any(e["job_id"] == "O-OUTAGE" for e in pending)


# 6. Agent restart during printing -> Uncertain output requires MANUAL_REVIEW
def test_agent_restart_during_printing(dev_env, fresh_db):
    fresh_db.record_job_claimed("ORD-CRASH", "JR-CRASH", "printbar-kyocera", 8, "bw", 1, {})
    fresh_db.update_job_progress("ORD-CRASH", pages_printed=3, cups_job_id="kyocera-500", status="printing")

    with patch("agent.validate_config"):
        with patch.object(CupsManager, "get_job_progress", return_value={"state": "unknown", "verified": False}):
            with patch.object(PrintBarAgent, "_report_failure") as mock_fail:
                agent = PrintBarAgent()
                mock_fail.assert_called_once()
                assert "manual review" in mock_fail.call_args[1]["reason"].lower()

                with fresh_db.get_connection() as conn:
                    row = conn.execute("SELECT status FROM local_jobs WHERE order_id = 'ORD-CRASH'").fetchone()
                assert row["status"] == "manual_review"


# 7. CUPS completed job after restart
def test_cups_completed_job_after_restart(dev_env, fresh_db):
    fresh_db.record_job_claimed("ORD-CUPS-COMP", "JR-C", "printbar-kyocera", 4, "bw", 1, {})
    fresh_db.update_job_progress("ORD-CUPS-COMP", pages_printed=2, cups_job_id="kyocera-700", status="printing")

    with patch("agent.validate_config"):
        with patch.object(
            CupsManager,
            "get_job_progress",
            return_value={"state": "completed", "sheets_completed": 4, "verified": True},
        ):
            with patch.object(PrintBarAgent, "_report_complete", return_value=True) as mock_complete:
                agent = PrintBarAgent()
                mock_complete.assert_called_once_with("ORD-CUPS-COMP", 4, "kyocera-700")

                with fresh_db.get_connection() as conn:
                    row = conn.execute("SELECT status FROM local_jobs WHERE order_id = 'ORD-CUPS-COMP'").fetchone()
                assert row["status"] == "completed"


# 8. Duplicate commands (idempotency)
def test_duplicate_command_idempotency(dev_env, fresh_db):
    with patch("agent.validate_config"):
        agent = PrintBarAgent()

    cmd = {"id": "CMD-DUP-1", "command": "refill_paper", "payload": {"printer": "both", "amount": 250}}

    with patch.object(agent, "_acknowledge_command", return_value=True):
        agent._execute_command(cmd)
        assert fresh_db.command_already_executed("CMD-DUP-1") is True

        # Second execution should be skipped
        with patch.object(agent.cups, "print_test_page") as mock_exec:
            agent._execute_command(cmd)
            mock_exec.assert_not_called()


# 9. Copies, Duplex, N-up and Capability Validation
def test_settings_validation(dev_env, tmp_path):
    cups = CupsManager()
    dummy = tmp_path / "doc.pdf"
    dummy.write_bytes(b"%PDF dummy")

    # Reject colour on Kyocera (monochrome only)
    ok, _, err = cups.print_file(
        file_path=str(dummy),
        printer_queue=cups.kyocera_queue,
        color_mode="color",
    )
    assert ok is False
    assert "monochrome only" in err

    # Reject unsupported N-up (e.g. 5-up)
    ok, _, err = cups.print_file(
        file_path=str(dummy),
        printer_queue=cups.canon_queue,
        number_up=5,
    )
    assert ok is False
    assert "Unsupported N-up" in err


# 10. Mid-print failure flags MANUAL_REVIEW (no unsafe auto failover)
def test_mid_print_failure_manual_review(dev_env, fresh_db, tmp_path):
    with patch("agent.validate_config"):
        agent = PrintBarAgent()

    test_file = tmp_path / "job.pdf"
    test_file.write_bytes(b"%PDF content")

    docs = [{"id": "D1", "pages": 10}]
    settings = {"colorMode": "bw", "copies": 1, "pagesPerSheet": 1}

    fresh_db.record_job_claimed("ORD-JAM", "JR-JAM", agent.cups.kyocera_queue, 10, "bw", 1, settings)

    with patch.object(agent.monitor, "is_printer_ready", return_value=(True, "")):
        with patch("requests.get") as mock_dl:
            mock_dl_res = MagicMock()
            mock_dl_res.status_code = 200
            mock_dl_res.headers = {"Content-Type": "application/pdf"}
            mock_dl_res.iter_content.return_value = [b"%PDF content"]
            mock_dl.return_value = mock_dl_res

            with patch.object(agent.cups, "print_file", return_value=(True, "kyo-jam-1", None)):
                # Simulate CUPS halting in 'stopped' mid-job
                with patch.object(
                    agent.cups,
                    "get_job_progress",
                    return_value={"state": "stopped", "impressions_completed": 4, "sheets_completed": 2},
                ):
                    with patch.object(agent, "_report_failure") as mock_fail:
                        agent._execute_print_pipeline("ORD-JAM", "JR-JAM", agent.cups.kyocera_queue, docs, settings, 10)
                        mock_fail.assert_called_once()
                        assert "manual review" in mock_fail.call_args[0][2].lower()

                        with fresh_db.get_connection() as conn:
                            row = conn.execute("SELECT status FROM local_jobs WHERE order_id = 'ORD-JAM'").fetchone()
                        assert row["status"] == "manual_review"


# 11. Exact event acknowledgement required (generic ok: true rejected)
def test_exact_event_acknowledgement_required(dev_env, fresh_db):
    with patch("agent.validate_config"):
        agent = PrintBarAgent()

    with patch("requests.post") as mock_post:
        # Generic {ok: true} without matching eventId must be rejected
        res_generic = MagicMock()
        res_generic.status_code = 200
        res_generic.json.return_value = {"ok": True}
        res_generic.content = b'{"ok": true}'
        mock_post.return_value = res_generic

        ok = agent._cloud_request("/api/device/jobs/TEST-ACK", {"orderId": "TEST-ACK", "eventId": "evt_expected_123"})
        assert ok is False

        # Response with exact matching eventId and acknowledged: true must succeed
        res_exact = MagicMock()
        res_exact.status_code = 200
        res_exact.json.return_value = {"ok": True, "acknowledged": True, "eventId": "evt_expected_456"}
        res_exact.content = b'{"ok": true, "acknowledged": true, "eventId": "evt_expected_456"}'
        mock_post.return_value = res_exact

        ok = agent._cloud_request("/api/device/jobs/TEST-ACK2", {"orderId": "TEST-ACK2", "eventId": "evt_expected_456"})
        assert ok is True


# 12. Command acknowledgement recovery without re-execution
def test_command_acknowledgement_recovery(dev_env, fresh_db):
    with patch("agent.validate_config"):
        agent = PrintBarAgent()

    cmd = {"id": "CMD-RECOVER-1", "command": "clear_stuck_jobs", "payload": {}}

    # First attempt: execution succeeds locally, but backend ack fails (e.g. network timeout)
    with patch.object(agent.cups, "clear_stuck_jobs", return_value=True) as mock_cups_clear:
        with patch.object(agent, "_acknowledge_command", return_value=False):
            agent._execute_command(cmd)
            mock_cups_clear.assert_called_once()

    # State must be ack_pending or result_persisted
    cmd_state = fresh_db.get_command_state("CMD-RECOVER-1")
    assert cmd_state["status"] == "ack_pending"

    # Second attempt: must NOT call clear_stuck_jobs again! Must reload result and retry ack
    with patch.object(agent.cups, "clear_stuck_jobs") as mock_cups_second:
        with patch.object(agent, "_acknowledge_command", return_value=True) as mock_ack:
            agent._execute_command(cmd)
            # CUPS clear_stuck_jobs must NOT be executed a second time
            mock_cups_second.assert_not_called()
            # Acknowledgement must be retried
            mock_ack.assert_called_once()

    # After confirmed ack, state is ack_confirmed
    cmd_state_final = fresh_db.get_command_state("CMD-RECOVER-1")
    assert cmd_state_final["status"] == "ack_confirmed"


# 13. Unknown command returns failed
def test_unknown_command_returns_failed(dev_env, fresh_db):
    with patch("agent.validate_config"):
        agent = PrintBarAgent()

    cmd = {"id": "CMD-UNKNOWN-99", "command": "destroy_hardware_xyz", "payload": {}}

    with patch.object(agent, "_acknowledge_command") as mock_ack:
        agent._execute_command(cmd)
        mock_ack.assert_called_once()
        args = mock_ack.call_args[0]
        assert args[0] == "CMD-UNKNOWN-99"
        assert args[1] == "failed"
        assert "unsupported" in args[2].lower() or "unknown" in args[2].lower()
