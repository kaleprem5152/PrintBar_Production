"""
Tests for printer_monitor.py — state classification, IPP parsing, reachability.
"""
import sys
import os
from unittest.mock import MagicMock, patch
import pytest

AGENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if AGENT_DIR not in sys.path:
    sys.path.insert(0, AGENT_DIR)

from printer_monitor import (
    PrinterMonitor,
    STATE_READY,
    STATE_PRINTING,
    STATE_PAPER_OUT,
    STATE_PAPER_JAM,
    STATE_OFFLINE,
    STATE_DISABLED,
    STATE_ERROR,
)


@pytest.fixture
def monitor():
    return PrinterMonitor(
        kyocera_ip="192.168.1.101",
        canon_ip="192.168.1.102",
        kyocera_queue="printbar-kyocera",
        canon_queue="printbar-canon",
    )


def test_classify_ipp_reasons(monitor):
    # Test paper out
    assert monitor._classify_ipp({"printer_state": 3, "printer_state_reasons": "media-empty"}) == STATE_PAPER_OUT
    # Test paper jam
    assert monitor._classify_ipp({"printer_state": 5, "printer_state_reasons": "media-jam"}) == STATE_PAPER_JAM
    # Test idle code
    assert monitor._classify_ipp({"printer_state": 3, "printer_state_reasons": "none"}) == STATE_READY
    # Test processing code
    assert monitor._classify_ipp({"printer_state": 4, "printer_state_reasons": "none"}) == STATE_PRINTING


def test_get_unified_status_offline(monitor):
    with patch.object(monitor, "_check_cups_queue", return_value={"state": "idle", "reason": ""}):
        with patch.object(monitor, "_check_tcp", return_value=False):
            st = monitor.get_unified_status("kyocera", "192.168.1.101", "printbar-kyocera")
            assert st["state"] == STATE_OFFLINE
            assert st["reachable"] is False


def test_get_unified_status_missing_queue_never_ready(monitor):
    # Even if IPP is reachable, missing queue must report error
    with patch.object(monitor, "_check_cups_queue", return_value={"state": "missing"}):
        with patch.object(monitor, "_check_tcp", return_value=True):
            with patch.object(monitor, "_check_ipp_status", return_value={"success": True, "printer_state": 3}):
                st = monitor.get_unified_status("kyocera", "192.168.1.101", "printbar-kyocera")
                assert st["state"] == STATE_ERROR
                assert "does not exist" in st["reason"]


def test_get_unified_status_ready_cups(monitor):
    with patch.object(monitor, "_check_cups_queue", return_value={"state": "idle", "reason": ""}):
        with patch.object(monitor, "_check_tcp", return_value=True):
            with patch.object(monitor, "_check_ipp_status", return_value={"success": False}):
                st = monitor.get_unified_status("kyocera", "192.168.1.101", "printbar-kyocera")
                assert st["state"] == STATE_READY
                assert st["reachable"] is True
                assert st["source"] == "cups"


def test_is_printer_ready_helper(monitor):
    with patch.object(monitor, "get_unified_status", return_value={"state": STATE_READY, "cups_state": "idle", "reason": ""}):
        ready, reason = monitor.is_printer_ready("kyocera")
        assert ready is True

    with patch.object(monitor, "get_unified_status", return_value={"state": STATE_PAPER_OUT, "cups_state": "idle", "reason": "media-empty"}):
        ready, reason = monitor.is_printer_ready("kyocera")
        assert ready is False
        assert "media-empty" in reason
