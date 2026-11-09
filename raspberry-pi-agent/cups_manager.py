"""
CUPS Printer Manager for PrintBar Raspberry Pi Agent.
Manages Kyocera ECOSYS PA3500x (Primary B&W) and Canon MAXIFY GX6170 (Color & B&W Fallback).
Supports authentic page-level progress monitoring, hardware status checks, queue flushing,
test page generation, and precise printer-option routing.

STRICT PRODUCTION RULES:
- Zero simulation or mock code.
- If CUPS executables (lp, lpstat, cancel) are missing, return explicit errors.
- Never invent 'sim-*' job IDs or fabricate readiness.
"""
import subprocess
import re
import os
import tempfile
import time
import logging
from typing import Dict, Any, Optional, Tuple, List
from config import KYOCERA_QUEUE, CANON_QUEUE

logger = logging.getLogger("printbar.cups")


class CupsManager:
    def __init__(self):
        self.kyocera_queue = KYOCERA_QUEUE
        self.canon_queue = CANON_QUEUE

    def check_printer_status(self) -> Dict[str, Any]:
        """
        Delegates exclusively to the authoritative PrinterMonitor implementation.
        Eliminates duplicate status logic, hardcoded toner flags, and fabricated readings.
        """
        from printer_monitor import PrinterMonitor, STATE_READY
        monitor = PrinterMonitor(
            kyocera_queue=self.kyocera_queue,
            canon_queue=self.canon_queue,
        )
        all_status = monitor.get_all_printer_status()
        k_stat = all_status.get("kyocera", {})
        c_stat = all_status.get("canon", {})

        k_ready = k_stat.get("state") == STATE_READY
        c_ready = c_stat.get("state") == STATE_READY

        cups_ok = k_stat.get("cups_state") not in (None, "missing") and c_stat.get("cups_state") not in (None, "missing")
        err = k_stat.get("reason") or c_stat.get("reason") or None

        return {
            "cups_reachable": cups_ok,
            "kyocera_ready": k_ready,
            "canon_ready": c_ready,
            "kyocera_status": k_stat.get("state", "unknown"),
            "canon_status": c_stat.get("state", "unknown"),
            "paper_ready": k_ready or c_ready,
            "toner_ok": None,  # Honest: unsupported/not fabricated
            "error": err,
            "source": "printer_monitor",
            "details": all_status,
        }

    def print_file(
        self,
        file_path: str,
        printer_queue: str,
        copies: int = 1,
        color_mode: str = "bw",
        paper_size: str = "A4",
        sides: str = "single",
        orientation: str = "portrait",
        page_range: Optional[str] = None,
        number_up: int = 1,
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Submit a document to the specified CUPS printer queue.
        Validates capabilities before submission.
        Returns (success: bool, cups_job_id: Optional[str], error_message: Optional[str])
        """
        if not os.path.isfile(file_path):
            return False, None, f"File does not exist: {file_path}"

        # Capability validation: Kyocera PA3500x is strictly monochrome
        if color_mode == "color" and printer_queue == self.kyocera_queue:
            return (
                False,
                None,
                f"Queue '{printer_queue}' is monochrome only and does not support colour printing.",
            )

        cmd = ["lp", "-d", printer_queue]

        # Copies
        cmd.extend(["-n", str(max(1, copies))])

        # Media size
        cmd.extend(["-o", f"media={paper_size}"])

        # Duplex / sides
        if sides == "double":
            cmd.extend(["-o", "sides=two-sided-long-edge"])
        else:
            cmd.extend(["-o", "sides=one-sided"])

        # Orientation
        if orientation == "landscape":
            cmd.extend(["-o", "orientation-requested=4"])
        else:
            cmd.extend(["-o", "orientation-requested=3"])

        # Color mode
        if color_mode == "color":
            cmd.extend(["-o", "print-color-mode=color"])
        else:
            cmd.extend(["-o", "print-color-mode=monochrome"])

        # N-up (pages per sheet)
        if number_up and number_up > 1:
            if number_up in (2, 4, 6, 9, 16):
                cmd.extend(["-o", f"number-up={number_up}"])
            else:
                return (
                    False,
                    None,
                    f"Unsupported N-up value: {number_up}. Supported options: 1, 2, 4, 6, 9, 16.",
                )

        # Optional page range
        if page_range:
            cmd.extend(["-o", f"page-ranges={page_range}"])

        cmd.append(file_path)

        logger.info(f"Submitting authentic CUPS job: {' '.join(cmd)}")

        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
            if res.returncode == 0:
                match = re.search(r"request id is ([^\s]+)", res.stdout)
                if match:
                    cups_job_id = match.group(1)
                    logger.info(f"CUPS accepted job: {cups_job_id}")
                    return True, cups_job_id, None
                logger.warning(f"Could not parse CUPS job ID from output: {res.stdout}")
                return True, "unknown_job_id", None
            else:
                error_msg = res.stderr.strip() or f"lp exited with code {res.returncode}"
                logger.error(f"CUPS print failure: {error_msg}")
                return False, None, error_msg

        except FileNotFoundError:
            err = "CUPS client binary (lp) not found. System printing packages not installed."
            logger.critical(err)
            return False, None, err
        except subprocess.TimeoutExpired:
            err = "CUPS submission (lp) timed out after 15s"
            logger.error(err)
            return False, None, err
        except Exception as e:
            logger.error(f"Exception during print submission: {e}")
            return False, None, str(e)

    def print_test_page(self, printer_queue: str) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Generates and submits a genuine test page to the requested printer queue.
        """
        temp_dir = tempfile.gettempdir()
        test_file = os.path.join(temp_dir, f"printbar_test_{printer_queue}_{int(time.time())}.txt")
        try:
            timestamp = time.strftime("%Y-%m-%d %H:%M:%S IST")
            with open(test_file, "w") as f:
                f.write("=========================================\n")
                f.write("       PRINTBAR KIOSK TEST PAGE          \n")
                f.write("  Location: SGU Food Court, Kolhapur     \n")
                f.write("=========================================\n\n")
                f.write(f"Target Queue: {printer_queue}\n")
                f.write(f"Timestamp:    {timestamp}\n")
                f.write("Status:       Hardware Diagnostics Verification\n")
                f.write("Status:       OK - CUPS Pipeline Functional\n\n")
                f.write("=========================================\n")

            return self.print_file(
                file_path=test_file,
                printer_queue=printer_queue,
                copies=1,
                color_mode="bw",
                paper_size="A4",
                sides="single",
                orientation="portrait",
            )
        finally:
            if os.path.exists(test_file):
                try:
                    os.remove(test_file)
                except Exception:
                    pass

    def get_cups_queue(self, printer_queue: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Query CUPS for pending jobs in the queue.
        """
        queue_jobs = []
        try:
            cmd = ["lpstat", "-o"]
            if printer_queue:
                cmd.append(printer_queue)
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
            if res.returncode == 0 and res.stdout:
                for line in res.stdout.strip().split("\n"):
                    if not line.strip():
                        continue
                    parts = line.split()
                    if parts:
                        queue_jobs.append(
                            {
                                "job_id": parts[0],
                                "user": parts[1] if len(parts) > 1 else "",
                                "size": parts[2] if len(parts) > 2 else "",
                                "raw": line,
                            }
                        )
        except Exception as e:
            logger.error(f"Error reading CUPS queue: {e}")
        return queue_jobs

    def clear_stuck_jobs(self, printer_queue: Optional[str] = None) -> bool:
        """
        Cancel stuck or pending jobs in the specified printer queue or all queues.
        """
        try:
            cmd = ["cancel", "-a"]
            if printer_queue:
                cmd.append(printer_queue)
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
            return res.returncode == 0
        except Exception as e:
            logger.error(f"Error clearing stuck jobs: {e}")
            return False

    def restart_cups(self) -> Tuple[bool, str]:
        """
        Restart the local CUPS service via systemctl.
        """
        try:
            res = subprocess.run(
                ["sudo", "systemctl", "restart", "cups"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if res.returncode == 0:
                return True, "CUPS service restarted successfully."
            return False, res.stderr.strip() or f"systemctl exited with {res.returncode}"
        except Exception as e:
            return False, str(e)

    def cancel_job(self, cups_job_id: str) -> bool:
        """Cancel a CUPS job by ID"""
        try:
            res = subprocess.run(["cancel", cups_job_id], capture_output=True, text=True, timeout=5)
            return res.returncode == 0
        except Exception:
            return False

    def get_job_progress(self, cups_job_id: str) -> Dict[str, Any]:
        """
        Query CUPS for authentic job progress attributes:
        - job-impressions-completed: printed sides / logical impressions
        - job-media-sheets-completed: physical sheets passed through
        - job-state: pending (3), processing (5), stopped (6), canceled (7), aborted (8), completed (9)
        """
        result = {
            "state": "unknown",
            "impressions_completed": 0,
            "sheets_completed": 0,
            "is_active": True,
            "verified": False,
        }

        if not cups_job_id or cups_job_id == "unknown_job_id":
            return result

        # 1. Try PyCUPS if installed
        try:
            import importlib
            cups = importlib.import_module("cups")
            conn = cups.Connection()
            job_num = int(cups_job_id.split("-")[-1]) if "-" in cups_job_id else int(cups_job_id)
            attrs = conn.getJobAttributes(job_num)
            if attrs:
                state_code = attrs.get("job-state", 0)
                impr = attrs.get("job-impressions-completed", 0)
                sheets = attrs.get("job-media-sheets-completed", 0)

                state_map = {
                    3: "pending",
                    4: "held",
                    5: "processing",
                    6: "stopped",
                    7: "canceled",
                    8: "aborted",
                    9: "completed",
                }
                result["state"] = state_map.get(state_code, "processing")
                result["impressions_completed"] = int(impr)
                result["sheets_completed"] = int(sheets)
                result["is_active"] = state_code in (3, 4, 5)
                result["verified"] = True
                return result
        except (ImportError, ValueError, Exception):
            pass

        # 2. Check via lpstat CLI
        try:
            res = subprocess.run(
                ["lpstat", "-l", cups_job_id], capture_output=True, text=True, timeout=5
            )
            if res.returncode == 0:
                output = res.stdout.lower()
                impr_match = re.search(r"job-impressions-completed[:=]\s*(\d+)", output)
                if impr_match:
                    result["impressions_completed"] = int(impr_match.group(1))

                sheets_match = re.search(r"job-media-sheets-completed[:=]\s*(\d+)", output)
                if sheets_match:
                    result["sheets_completed"] = int(sheets_match.group(1))

                status_text = re.sub(r"job-[a-z0-9\-]+-completed", "", output)
                if re.search(r"\b(completed|finished)\b", status_text):
                    result["state"] = "completed"
                    result["is_active"] = False
                elif re.search(r"\b(stopped|failed)\b", status_text):
                    result["state"] = "stopped"
                    result["is_active"] = False
                elif re.search(r"\b(canceled|cancelled|aborted)\b", status_text):
                    result["state"] = "canceled"
                    result["is_active"] = False
                elif re.search(r"\b(pending|held)\b", status_text):
                    result["state"] = "pending"
                    result["is_active"] = True
                else:
                    result["state"] = "processing"
                    result["is_active"] = True

                result["verified"] = True
                return result
            else:
                # Job not in active list — check completed history
                comp_res = subprocess.run(
                    ["lpstat", "-W", "completed", "-l", cups_job_id],
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                if comp_res.returncode == 0 and comp_res.stdout:
                    result["state"] = "completed"
                    result["is_active"] = False
                    result["verified"] = True
                    return result
        except FileNotFoundError:
            result["state"] = "unknown"
            result["is_active"] = False
            result["verified"] = False
            return result
        except Exception as e:
            logger.debug(f"Could not read lpstat progress for {cups_job_id}: {e}")

        return result
