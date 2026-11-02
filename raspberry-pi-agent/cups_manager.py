"""
CUPS Printer Manager for PrintBar Raspberry Pi Agent.
Manages Kyocera ECOSYS PA3500x (Primary B&W) and Canon MAXIFY GX6170 (Color & B&W Fallback).
"""
import subprocess
import re
import os
import logging
from typing import Dict, Any, Optional, Tuple
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
                logger.warning(f"lpstat -p returned non-zero ({res.returncode}): {res.stderr}")
        except FileNotFoundError:
            # lpstat not installed on dev machine — simulate ready
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
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Submit a document to the specified CUPS printer queue.
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

    def cancel_job(self, cups_job_id: str) -> bool:
        """Cancel a CUPS job by ID"""
        try:
            res = subprocess.run(["cancel", cups_job_id], capture_output=True, text=True, timeout=5)
            return res.returncode == 0
        except Exception:
            return False
