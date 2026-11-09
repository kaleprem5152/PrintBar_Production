"""
CUPS Printer Manager for PrintBar Raspberry Pi Agent.
Manages Kyocera ECOSYS PA3500x (Primary B&W) and Canon MAXIFY GX6170 (Color & B&W Fallback).
Supports authentic page-level progress monitoring, hardware status checks, queue flushing,
test page generation, and precise partial-page failover routing.
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
        Check CUPS status for both physical printers using lpstat.
        Returns a dict with readiness flags and raw details.
        """
        status = {
            "cups_reachable": True,
            "kyocera_ready": True,
            "canon_ready": True,
            "kyocera_status": "idle",
            "canon_status": "idle",
            "paper_ready": True,
            "toner_ok": True,
        }

        try:
            res = subprocess.run(["lpstat", "-p"], capture_output=True, text=True, timeout=5)
            if res.returncode == 0:
                output = res.stdout.lower()
                # Check Kyocera
                if self.kyocera_queue.lower() in output:
                    k_match = re.search(rf"printer {self.kyocera_queue.lower()} (is idle|is printing|is disabled)", output)
                    if k_match:
                        k_state = k_match.group(1)
                        status["kyocera_status"] = k_state
                        if "disabled" in k_state:
                            status["kyocera_ready"] = False
                    else:
                        status["kyocera_ready"] = False

                # Check Canon
                if self.canon_queue.lower() in output:
                    c_match = re.search(rf"printer {self.canon_queue.lower()} (is idle|is printing|is disabled)", output)
                    if c_match:
                        c_state = c_match.group(1)
                        status["canon_status"] = c_state
                        if "disabled" in c_state:
                            status["canon_ready"] = False
                    else:
                        status["canon_ready"] = False
            else:
                status["cups_reachable"] = False
                logger.warning(f"lpstat -p returned non-zero ({res.returncode}): {res.stderr}")
        except FileNotFoundError:
            # lpstat not installed on dev machine — simulate ready
            status["cups_reachable"] = True
            logger.debug("lpstat command not found. Simulating printers ready for dev environment.")
        except Exception as e:
            logger.error(f"Error checking printer status: {e}")

        return status

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
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Submit a document to the specified CUPS printer queue.
        Supports page_range (e.g. '3-10') for seamless partial-failover resumption.
        Returns (success: bool, cups_job_id: Optional[str], error_message: Optional[str])
        """
        if not os.path.isfile(file_path):
            return False, None, f"File does not exist: {file_path}"

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

        # Optional page range for failover / partial printing
        if page_range:
            cmd.extend(["-o", f"page-ranges={page_range}"])

        cmd.append(file_path)

        logger.info(f"Submitting CUPS job: {' '.join(cmd)}")

        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
            if res.returncode == 0:
                # Output like: "request id is Kyocera_PA3500x-105 (1 file(s))"
                match = re.search(r"request id is ([^\s]+)", res.stdout)
                cups_job_id = match.group(1) if match else "cups-job-submitted"
                logger.info(f"CUPS job successfully submitted: {cups_job_id}")
                return True, cups_job_id, None
            else:
                err = res.stderr.strip() or f"lp exited with code {res.returncode}"
                logger.error(f"CUPS submission failed: {err}")
                return False, None, err
        except FileNotFoundError:
            # lp not found (development environment simulation)
            sim_id = f"sim-{printer_queue}-{os.path.basename(file_path)[:8]}"
            logger.info(f"[DEV SIMULATION] Simulated CUPS job: {sim_id}")
            return True, sim_id, None
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
                    # Format: Queue_Name-123 user 1024 Thu 01 Jan 2026 ...
                    parts = line.split()
                    if parts:
                        job_id = parts[0]
                        queue_jobs.append({
                            "job_id": job_id,
                            "user": parts[1] if len(parts) > 1 else "unknown",
                            "size": parts[2] if len(parts) > 2 else "unknown",
                            "raw": line.strip(),
                        })
        except Exception as e:
            logger.debug(f"Could not fetch CUPS queue: {e}")
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
            res = subprocess.run(["sudo", "systemctl", "restart", "cups"], capture_output=True, text=True, timeout=10)
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

        if not cups_job_id:
            return result

        # Check PyCUPS if installed
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

        # Check via lpstat CLI
        try:
            res = subprocess.run(["lpstat", "-l", cups_job_id], capture_output=True, text=True, timeout=5)
            if res.returncode == 0:
                output = res.stdout.lower()
                # Search for impressions
                impr_match = re.search(r"job-impressions-completed[:=]\s*(\d+)", output)
                if impr_match:
                    result["impressions_completed"] = int(impr_match.group(1))

                sheets_match = re.search(r"job-media-sheets-completed[:=]\s*(\d+)", output)
                if sheets_match:
                    result["sheets_completed"] = int(sheets_match.group(1))

                if "completed" in output or "finished" in output:
                    result["state"] = "completed"
                    result["is_active"] = False
                elif "stopped" in output or "failed" in output:
                    result["state"] = "stopped"
                    result["is_active"] = False
                elif "canceled" in output or "cancelled" in output:
                    result["state"] = "canceled"
                    result["is_active"] = False
                else:
                    result["state"] = "processing"
                    result["is_active"] = True

                result["verified"] = True
                return result
            else:
                # Job not found in active list — check completed jobs
                comp_res = subprocess.run(["lpstat", "-W", "completed", "-l", cups_job_id], capture_output=True, text=True, timeout=5)
                if comp_res.returncode == 0 and comp_res.stdout:
                    result["state"] = "completed"
                    result["is_active"] = False
                    result["verified"] = True
                    return result
        except FileNotFoundError:
            # lpstat not on dev host
            if cups_job_id.startswith("sim-"):
                result["state"] = "completed"
                result["is_active"] = False
                result["verified"] = False
                return result
        except Exception as e:
            logger.debug(f"Could not read lpstat progress for {cups_job_id}: {e}")

        return result
