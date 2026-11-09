"""
Tests for agent.py — daemon initialization, recovery, remote command execution, fallback logic.
"""
import sys
import os
import json
from unittest.mock import MagicMock, patch
import pytest

AGENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if AGENT_DIR not in sys.path:
    sys.path.insert(0, AGENT_DIR)

import db
from agent import PrintBarAgent


@pytest.fixture
def agent(dev_env, fresh_db):
    with patch("agent.validate_config"):
        a = PrintBarAgent()
        return a


def test_agent_init(agent):
    assert agent.kyocera_paper == 250
    assert agent.canon_paper == 250
    assert agent.paper_ready is True
    assert agent.maintenance_mode is False


def test_startup_recovery(dev_env, fresh_db):
    # Pre-populate an incomplete job in SQLite
    fresh_db.record_job_claimed(
        order_id="ORD-RECOVER-1",
        job_ref="PB-REC-1",
        printer_name="printbar-kyocera",
        pages_to_print=5,
        color_mode="bw",
        copies=1,
        settings={"copies": 1},
    )
    fresh_db.update_job_progress("ORD-RECOVER-1", pages_printed=2, status="printing")

    with patch("agent.validate_config"):
        with patch.object(PrintBarAgent, "_report_failure") as mock_fail:
            a = PrintBarAgent()
            # Must report failure for the orphaned job
            mock_fail.assert_called_once()
            args = mock_fail.call_args[0]
            assert args[0] == "ORD-RECOVER-1"
            assert mock_fail.call_args[1]["pages_printed"] == 2

            # Job status in DB should now be failed
            incomplete = fresh_db.get_incomplete_jobs()
            assert not any(j["order_id"] == "ORD-RECOVER-1" for j in incomplete)


def test_execute_remote_command_refill(agent):
    agent.kyocera_paper = 10
    agent.canon_paper = 20

    cmd = {
        "id": "CMD-REFILL-1",
        "command": "refill_paper",
        "printerId": None,
        "payload": {"printer": "both", "amount": 250},
    }

    with patch.object(agent, "_acknowledge_command", return_value=True) as mock_ack:
        agent._execute_command(cmd)
        assert agent.kyocera_paper == 250
        assert agent.canon_paper == 250
        mock_ack.assert_called_once()
        assert mock_ack.call_args[0][1] == "succeeded"


def test_execute_remote_command_test_print(agent):
    cmd = {
        "id": "CMD-TEST-1",
        "command": "test_print",
        "printerId": "kyocera_pa3500x",
        "payload": {},
    }

    with patch.object(agent.cups, "print_test_page", return_value=(True, "test-job-99", None)):
        with patch.object(agent, "_acknowledge_command", return_value=True) as mock_ack:
            agent._execute_command(cmd)
            mock_ack.assert_called_once()
            assert mock_ack.call_args[0][1] == "succeeded"
            assert "test-job-99" in mock_ack.call_args[0][2]


def test_heartbeat_payload_generation(agent):
    with patch("requests.post") as mock_post:
        mock_res = MagicMock()
        mock_res.status_code = 200
        mock_res.json.return_value = {
            "kyoceraPaper": 240,
            "canonPaper": 250,
            "paperReady": True,
            "maintenanceMode": False,
        }
        mock_post.return_value = mock_res

        agent.send_heartbeat()

        assert agent.kyocera_paper == 240
        assert agent.last_heartbeat_time > 0
        assert mock_post.call_count >= 1

