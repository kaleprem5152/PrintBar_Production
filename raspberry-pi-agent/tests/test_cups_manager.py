"""
Tests for cups_manager.py — CUPS integration, page ranges, queue flushing, test prints.
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


@pytest.fixture
def cups():
    return CupsManager()


def test_init(cups):
    assert cups.kyocera_queue == "printbar-kyocera"
    assert cups.canon_queue == "printbar-canon"


def test_print_file_missing_file(cups):
    success, job_id, err = cups.print_file(
        file_path="/path/to/nonexistent/file.pdf",
        printer_queue=cups.kyocera_queue,
    )
    assert success is False
    assert job_id is None
    assert "File does not exist" in err


def test_print_file_success(cups, tmp_path):
    dummy_file = tmp_path / "sample.pdf"
    dummy_file.write_bytes(b"%PDF-1.4 mock content")

    mock_res = MagicMock()
    mock_res.returncode = 0
    mock_res.stdout = "request id is printbar-kyocera-101 (1 file(s))\n"
    mock_res.stderr = ""

    with patch("subprocess.run", return_value=mock_res) as mock_run:
        success, job_id, err = cups.print_file(
            file_path=str(dummy_file),
            printer_queue=cups.kyocera_queue,
            copies=2,
            color_mode="bw",
            paper_size="A4",
            sides="double",
            orientation="portrait",
            page_range="2-5",
        )
        assert success is True
        assert job_id == "printbar-kyocera-101"
        assert err is None

        # Verify command arguments passed to lp
        args = mock_run.call_args[0][0]
        assert "lp" == args[0]
        assert "-d" in args and cups.kyocera_queue in args
        assert "-n" in args and "2" in args
        assert "-o" in args and "page-ranges=2-5" in args
        assert "-o" in args and "sides=two-sided-long-edge" in args
        assert "-o" in args and "print-color-mode=monochrome" in args


def test_print_file_failure(cups, tmp_path):
    dummy_file = tmp_path / "sample.pdf"
    dummy_file.write_bytes(b"%PDF-1.4 mock content")

    mock_res = MagicMock()
    mock_res.returncode = 1
    mock_res.stdout = ""
    mock_res.stderr = "lp: Error - queue stopped"

    with patch("subprocess.run", return_value=mock_res):
        success, job_id, err = cups.print_file(
            file_path=str(dummy_file),
            printer_queue=cups.kyocera_queue,
        )
        assert success is False
        assert job_id is None
        assert "Error - queue stopped" in err


def test_cancel_job(cups):
    mock_res = MagicMock()
    mock_res.returncode = 0
    with patch("subprocess.run", return_value=mock_res) as mock_run:
        ok = cups.cancel_job("printbar-kyocera-101")
        assert ok is True
        args = mock_run.call_args[0][0]
        assert args == ["cancel", "printbar-kyocera-101"]


def test_get_job_progress_lpstat(cups):
    mock_res = MagicMock()
    mock_res.returncode = 0
    mock_res.stdout = """
printbar-kyocera-101 root 1024 Mon Nov 09 18:00:00 2026
        job-impressions-completed: 4
        job-media-sheets-completed: 2
        Status: processing
    """
    with patch("subprocess.run", return_value=mock_res):
        prog = cups.get_job_progress("printbar-kyocera-101")
        assert prog["verified"] is True
        assert prog["impressions_completed"] == 4
        assert prog["sheets_completed"] == 2
        assert prog["state"] == "processing"
        assert prog["is_active"] is True

