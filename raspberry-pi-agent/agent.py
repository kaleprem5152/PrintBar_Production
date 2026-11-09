"""
PrintBar Raspberry Pi Agent — Main Autonomous Daemon.
Runs autonomously on the physical Raspberry Pi inside the PrintBar kiosk.
Handles:
- Authentic hardware telemetry (CPU temp, CPU%, RAM%, disk usage)
- Real-time printer status monitoring via CUPS (Kyocera PA3500x & Canon GX6170)
- Remote administrative command polling and execution (test_print, cups_queue, clear_stuck, restart)
- Atomic cloud job claiming
- Secure file download & forensic shredding
- Dual-printer routing with precise partial-page failover (no duplicate pages printed)
- Physical paper inventory enforcement (250 sheets per tray)
"""
import time
import os
import sys
import shutil
import logging
import requests
from typing import Dict, Any, List, Optional
from config import (
    CLOUD_API_URL,
    DEVICE_ID,
    POLL_INTERVAL_SECONDS,
    HEARTBEAT_INTERVAL_SECONDS,
    KYOCERA_QUEUE,
    CANON_QUEUE,
    JOB_DOWNLOAD_DIR,
)
from auth import get_auth_headers
from db import (
    init_db,
    record_job_claimed,
    update_job_progress,
    mark_job_completed,
    mark_job_failed,
    get_active_job,
)
from cups_manager import CupsManager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("printbar.agent")

class PrintBarAgent:
    def __init__(self):
        self.cups = CupsManager()
        self.last_heartbeat_time = 0
        self.last_command_poll_time = 0
        self.kyocera_paper = 250
        self.canon_paper = 250
        self.paper_ready = True
        self.maintenance_mode = False
        init_db()

    def get_system_telemetry(self) -> Dict[str, Any]:
        """Collect real Raspberry Pi 5 hardware metrics without synthetic mocking."""
        telemetry: Dict[str, Any] = {
            "tempC": None,
            "cpuPct": None,
            "memPct": None,
            "diskPct": None,
        }

        # 1. Thermal reading from Pi thermal zone
        try:
            thermal_path = "/sys/class/thermal/thermal_zone0/temp"
            if os.path.exists(thermal_path):
                with open(thermal_path, "r") as f:
                    raw_temp = f.read().strip()
                    telemetry["tempC"] = round(float(raw_temp) / 1000.0, 1)
        except Exception:
            pass

        # 2. Disk usage of root partition
        try:
            usage = shutil.disk_usage("/")
            telemetry["diskPct"] = round((usage.used / usage.total) * 100)
        except Exception:
            pass

        # 3. CPU & Memory via psutil or /proc
        try:
            import psutil
            telemetry["cpuPct"] = round(psutil.cpu_percent(interval=None))
            telemetry["memPct"] = round(psutil.virtual_memory().percent)
            if telemetry["tempC"] is None and hasattr(psutil, "sensors_temperatures"):
                temps = psutil.sensors_temperatures()
                if "cpu_thermal" in temps and temps["cpu_thermal"]:
                    telemetry["tempC"] = round(temps["cpu_thermal"][0].current, 1)
        except ImportError:
            # Fallback for systems without psutil installed
            try:
                if os.path.exists("/proc/loadavg"):
                    with open("/proc/loadavg", "r") as f:
                        load1 = float(f.read().split()[0])
                        # Approximate CPU % on 4-core Pi
                        telemetry["cpuPct"] = min(100, round((load1 / 4.0) * 100))
                if os.path.exists("/proc/meminfo"):
                    with open("/proc/meminfo", "r") as f:
                        lines = f.readlines()
                        mem_total, mem_free = 0, 0
                        for line in lines:
                            if "MemTotal" in line:
                                mem_total = int(line.split()[1])
                            elif "MemAvailable" in line:
                                mem_free = int(line.split()[1])
                        if mem_total > 0:
                            telemetry["memPct"] = round(((mem_total - mem_free) / mem_total) * 100)
            except Exception:
                pass

        return telemetry

    def send_heartbeat(self):
        """Report physical printer and Pi hardware states to both backend telemetry endpoints."""
        now = time.time()
        if now - self.last_heartbeat_time < HEARTBEAT_INTERVAL_SECONDS:
            return

        status = self.cups.check_printer_status()
        telemetry = self.get_system_telemetry()
        headers = get_auth_headers()
        headers["Content-Type"] = "application/json"

        # 1. Device Heartbeat (/api/device/heartbeat)
        device_url = f"{CLOUD_API_URL}/api/device/heartbeat"
        device_payload = {
            "kyoceraReady":  status.get("kyocera_ready", True),
            "canonReady":    status.get("canon_ready", True),
            "kyoceraStatus": status.get("kyocera_status", "idle"),
            "canonStatus":   status.get("canon_status", "idle"),
            "cupsReachable": status.get("cups_reachable", True),
            "agentVersion":  "2.5.0",
            "paperReady":    (self.kyocera_paper > 0 or self.canon_paper > 0) and status.get("paper_ready", True),
            "tonerOk":       status.get("toner_ok", True),
        }

        try:
            res = requests.post(device_url, json=device_payload, headers=headers, timeout=10)
            if res.status_code == 200:
                hb_data = res.json()
                self.kyocera_paper = hb_data.get("kyoceraPaper", self.kyocera_paper)
                self.canon_paper = hb_data.get("canonPaper", self.canon_paper)
                self.paper_ready = hb_data.get("paperReady", True)
                self.maintenance_mode = hb_data.get("maintenanceMode", False)
        except Exception as e:
            logger.warning(f"Device heartbeat network error: {e}")

        # 2. Admin Telemetry Heartbeat (/api/agent/heartbeat)
        admin_url = f"{CLOUD_API_URL}/api/agent/heartbeat"
        admin_payload = {
            "kioskId": DEVICE_ID,
            "softwareVersion": "2.5.0",
            "networkType": "ethernet",
            "pi": telemetry,
            "printers": [
                {
                    "id": "kyocera_pa3500x",
                    "connected": status.get("kyocera_ready", True),
                    "state": "idle" if status.get("kyocera_ready", True) else "error",
                    "paperRemaining": self.kyocera_paper,
                    "errorMessage": None if status.get("kyocera_ready", True) else "Kyocera PA3500x unavailable",
                },
                {
                    "id": "canon_gx6170",
                    "connected": status.get("canon_ready", True),
                    "state": "idle" if status.get("canon_ready", True) else "error",
                    "paperRemaining": self.canon_paper,
                    "errorMessage": None if status.get("canon_ready", True) else "Canon GX6170 unavailable",
                },
            ],
        }

        try:
            res_admin = requests.post(admin_url, json=admin_payload, headers=headers, timeout=10)
            if res_admin.status_code == 200:
                logger.debug("Admin telemetry heartbeat acknowledged.")
        except Exception as e:
            logger.debug(f"Admin telemetry heartbeat notice: {e}")

        self.last_heartbeat_time = now

    def poll_and_execute_commands(self):
        """Poll and execute operator commands issued from the Admin Control Centre."""
        now = time.time()
        if now - self.last_command_poll_time < 5:
            return
        self.last_command_poll_time = now

        url = f"{CLOUD_API_URL}/api/agent/commands?kioskId={DEVICE_ID}"
        headers = get_auth_headers()

        try:
            res = requests.get(url, headers=headers, timeout=10)
            if res.status_code != 200:
                return

            data = res.json()
            commands = data.get("commands", [])
            for cmd in commands:
                self.execute_command(cmd)

        except Exception as e:
            logger.debug(f"Command poll error: {e}")

    def execute_command(self, cmd: Dict[str, Any]):
        """Execute a remote admin command and report result back."""
        cmd_id = cmd.get("id")
        action = cmd.get("command")
        printer_id = cmd.get("printerId")
        payload = cmd.get("payload") or {}

        logger.info(f"Executing remote command #{cmd_id}: {action} (printer: {printer_id})")

        status = "succeeded"
        result_msg = ""

        try:
            target_queue = CANON_QUEUE if printer_id and "canon" in printer_id.lower() else KYOCERA_QUEUE

            if action == "test_print":
                success, cups_id, err = self.cups.print_test_page(target_queue)
                if success:
                    result_msg = f"Test page sent to {target_queue} (CUPS: {cups_id})"
                else:
                    status = "failed"
                    result_msg = f"Test print failed: {err}"

            elif action == "fetch_cups_queue":
                queue_items = self.cups.get_cups_queue(target_queue)
                result_msg = f"Queue {target_queue}: {len(queue_items)} job(s) pending."

            elif action == "clear_stuck_jobs":
                ok = self.cups.clear_stuck_jobs(target_queue)
                result_msg = f"Cleared stuck jobs on {target_queue}." if ok else "Failed to clear stuck jobs."
                if not ok:
                    status = "failed"

            elif action == "restart_print_service":
                ok, msg = self.cups.restart_cups()
                result_msg = msg
                if not ok:
                    status = "failed"

            elif action == "run_diagnostics":
                diag = self.cups.check_printer_status()
                telem = self.get_system_telemetry()
                result_msg = f"CUPS: {diag.get('cups_reachable')}, K-Ready: {diag.get('kyocera_ready')}, C-Ready: {diag.get('canon_ready')}, Temp: {telem.get('tempC')}C"

            elif action == "refill_paper":
                self.kyocera_paper = 250
                self.canon_paper = 250
                self.paper_ready = True
                result_msg = "Both paper trays refilled to 250 sheets."

            elif action == "restart_agent":
                result_msg = "Agent restarting..."
                self.acknowledge_command(cmd_id, status, result_msg)
                time.sleep(1)
                os.execv(sys.executable, [sys.executable] + sys.argv)
                return

            else:
                result_msg = f"Command {action} processed."

        except Exception as e:
            status = "failed"
            result_msg = f"Exception executing {action}: {e}"
            logger.error(result_msg)

        self.acknowledge_command(cmd_id, status, result_msg)

    def acknowledge_command(self, cmd_id: int, status: str, result: str):
        """Send command execution report back to cloud backend."""
        ack_url = f"{CLOUD_API_URL}/api/agent/commands/{cmd_id}"
        headers = get_auth_headers()
        headers["Content-Type"] = "application/json"
        try:
            requests.post(ack_url, json={"status": status, "result": result[:500]}, headers=headers, timeout=10)
        except Exception as e:
            logger.warning(f"Could not acknowledge command #{cmd_id}: {e}")

    def poll_and_process_jobs(self):
        """Query cloud API for available jobs and process them."""
        if self.maintenance_mode:
            return

        if not self.paper_ready or (self.kyocera_paper <= 0 and self.canon_paper <= 0):
            logger.warning("Kiosk is out of paper; skipping job polling until paper is refilled.")
            return

        url = f"{CLOUD_API_URL}/api/device/jobs"
        headers = get_auth_headers()

        try:
            res = requests.get(url, headers=headers, timeout=10)
            if res.status_code != 200:
                return

            data = res.json()
            jobs = data.get("jobs", [])
            if not jobs:
                return

            job_candidate = jobs[0]
            self.claim_and_execute_job(job_candidate["orderId"])

        except Exception as e:
            logger.error(f"Error polling jobs: {e}")

    def claim_and_execute_job(self, order_id: str):
        """Atomically claim a specific order and execute the print sequence."""
        claim_url = f"{CLOUD_API_URL}/api/device/jobs"
        headers = get_auth_headers()
        headers["Content-Type"] = "application/json"

        try:
            res = requests.post(claim_url, json={"orderId": order_id}, headers=headers, timeout=10)
            if res.status_code != 200:
                logger.info(f"Could not claim job {order_id}: {res.text}")
                return

            claim_data = res.json()
            job_ref = claim_data["jobRef"]
            settings = claim_data["settings"]
            docs = claim_data["docs"]
            pages_to_print = claim_data["pagesToPrint"]
            color_mode = settings.get("colorMode", "bw")
            copies = settings.get("copies", 1)

            # Route printer
            primary_queue = CANON_QUEUE if color_mode == "color" else KYOCERA_QUEUE
            logger.info(f"Claimed job {order_id} ({job_ref}). Target printer: {primary_queue}. Pages: {pages_to_print}")

            record_job_claimed(order_id, job_ref, primary_queue, pages_to_print, color_mode, copies, settings)
            self.execute_print_pipeline(order_id, job_ref, primary_queue, docs, settings, pages_to_print)

        except Exception as e:
            logger.error(f"Error claiming job {order_id}: {e}")

    def execute_print_pipeline(
        self,
        order_id: str,
        job_ref: str,
        primary_queue: str,
        docs: List[Dict[str, Any]],
        settings: Dict[str, Any],
        pages_to_print: int
    ):
        """Download files, send to CUPS, track progress, handle fallback with partial page range, report completion."""
        downloaded_files: List[str] = []
        total_pages_printed = 0
        cups_job_id: Any = None
        os.makedirs(str(JOB_DOWNLOAD_DIR), exist_ok=True)

        try:
            # Step 1: Download files
            for doc in docs:
                doc_id = doc["id"]
                kind = doc.get("kind", "pdf")

                dl_url = f"{CLOUD_API_URL}/api/device/jobs/{order_id}/files/{doc_id}"
                headers = get_auth_headers()

                logger.info(f"Downloading doc {doc_id} for order {order_id}...")
                dl_res = requests.get(dl_url, headers=headers, timeout=30)
                if dl_res.status_code != 200:
                    raise Exception(f"Failed to download doc {doc_id}: HTTP {dl_res.status_code}")

                content_type = dl_res.headers.get("Content-Type", "")
                ext = "pdf" if "pdf" in content_type else kind
                file_path = str(JOB_DOWNLOAD_DIR / f"{doc_id}.{ext}")

                with open(file_path, "wb") as f:
                    f.write(dl_res.content)
                downloaded_files.append(file_path)

            # Step 2: Notify cloud processing started
            self.report_progress(order_id, pages_printed=0, status="processing")

            # Step 3: Print each file
            color_mode = settings.get("colorMode", "bw")
            copies = settings.get("copies", 1)
            paper_size = settings.get("paperSize", "A4")
            sides = settings.get("sides", "single")
            orientation = settings.get("orientation", "portrait")

            for file_path in downloaded_files:
                # Submit to primary printer
                success, submitted_cups_id, err = self.cups.print_file(
                    file_path=file_path,
                    printer_queue=primary_queue,
                    copies=copies,
                    color_mode=color_mode,
                    paper_size=paper_size,
                    sides=sides,
                    orientation=orientation,
                )

                if not success:
                    # If primary Kyocera fails on B&W, attempt fallback to Canon
                    if color_mode == "bw" and primary_queue == KYOCERA_QUEUE:
                        logger.warning(f"Kyocera failed ({err}). Triggering fallback to Canon MAXIFY GX6170...")
                        fallback_success = self.trigger_fallback(order_id, total_pages_printed, err, submitted_cups_id)
                        if fallback_success:
                            # Resume remaining pages only (never duplicate already printed pages)
                            remaining_start = total_pages_printed + 1
                            remaining_range = f"{remaining_start}-{pages_to_print}" if remaining_start <= pages_to_print else None

                            fb_success, fb_cups_id, fb_err = self.cups.print_file(
                                file_path=file_path,
                                printer_queue=CANON_QUEUE,
                                copies=copies,
                                color_mode="bw",
                                paper_size=paper_size,
                                sides=sides,
                                orientation=orientation,
                                page_range=remaining_range,
                            )
                            if not fb_success:
                                raise Exception(f"Fallback printer also failed: {fb_err}")
                            cups_job_id = fb_cups_id
                        else:
                            raise Exception(f"Kyocera failed and cloud rejected fallback: {err}")
                    else:
                        raise Exception(f"Print submission failed: {err}")
                else:
                    cups_job_id = submitted_cups_id

                # Notify cloud printing started
                self.report_progress(order_id, pages_printed=total_pages_printed, cups_job_id=cups_job_id, status="printing")

                # Monitor authentic CUPS printing progress
                doc_pages_printed = 0
                poll_start = time.time()
                timeout = max(90, pages_to_print * 20)

                while time.time() - poll_start < timeout:
                    prog = self.cups.get_job_progress(cups_job_id)
                    state = prog.get("state", "processing")
                    impr = prog.get("impressions_completed", 0)

                    if impr > doc_pages_printed:
                        diff = impr - doc_pages_printed
                        doc_pages_printed = impr
                        total_pages_printed = min(pages_to_print, total_pages_printed + diff)
                        self.report_progress(order_id, pages_printed=total_pages_printed, cups_job_id=cups_job_id)

                    if state == "completed":
                        logger.info(f"CUPS reported job {cups_job_id} completed successfully.")
                        break
                    elif state in ("stopped", "canceled", "aborted"):
                        # If stopped on Kyocera mid-print, fail over remaining pages to Canon
                        if color_mode == "bw" and primary_queue == KYOCERA_QUEUE and total_pages_printed < pages_to_print:
                            logger.warning(f"Kyocera halted at page {total_pages_printed}/{pages_to_print}. Switching remaining pages to Canon...")
                            self.cups.cancel_job(cups_job_id)
                            rem_start = total_pages_printed + 1
                            rem_range = f"{rem_start}-{pages_to_print}"
                            self.trigger_fallback(order_id, total_pages_printed, f"Interrupted at page {total_pages_printed}", cups_job_id)
                            fb_ok, fb_id, fb_err = self.cups.print_file(
                                file_path=file_path,
                                printer_queue=CANON_QUEUE,
                                copies=copies,
                                color_mode="bw",
                                paper_size=paper_size,
                                sides=sides,
                                orientation=orientation,
                                page_range=rem_range,
                            )
                            if fb_ok:
                                cups_job_id = fb_id
                                primary_queue = CANON_QUEUE
                                doc_pages_printed = 0
                                poll_start = time.time()
                                continue
                            else:
                                raise Exception(f"Fallback to Canon failed: {fb_err}")

                        raise Exception(f"Hardware interrupt: CUPS job {cups_job_id} transitioned to state '{state}'")

                    time.sleep(1.0)

            # Step 4: Report Completion
            self.report_complete(order_id, pages_printed=pages_to_print, cups_job_id=cups_job_id)
            mark_job_completed(order_id)
            logger.info(f"Job {order_id} completed successfully!")

        except Exception as e:
            logger.error(f"Job {order_id} failed during execution: {e}")
            self.report_failure(order_id, pages_printed=total_pages_printed, reason=str(e))
            mark_job_failed(order_id)
        finally:
            # Step 5: Forensic Document Shredding — securely overwrite and remove files
            for fp in downloaded_files:
                self.secure_delete_file(fp)

    def trigger_fallback(self, order_id: str, pages_printed: int, reason: str, previous_cups_job_id: str = None) -> bool:
        """Call cloud API to transition job to fallback_pending on Canon."""
        url = f"{CLOUD_API_URL}/api/device/jobs/{order_id}?action=fallback"
        headers = get_auth_headers()
        headers["Content-Type"] = "application/json"
        payload = {"pagesPrinted": pages_printed, "reason": reason}
        if previous_cups_job_id:
            payload["previousCupsJobId"] = previous_cups_job_id
        try:
            res = requests.post(url, json=payload, headers=headers, timeout=10)
            return res.status_code == 200
        except Exception as e:
            logger.error(f"Fallback request error: {e}")
            return False

    def report_progress(self, order_id: str, pages_printed: int, cups_job_id: str = None, status: str = None):
        """PATCH cloud API progress update."""
        url = f"{CLOUD_API_URL}/api/device/jobs/{order_id}"
        headers = get_auth_headers()
        headers["Content-Type"] = "application/json"
        payload: Dict[str, Any] = {"pagesPrinted": pages_printed}
        if cups_job_id:
            payload["cupsJobId"] = cups_job_id
        if status:
            payload["status"] = status

        try:
            requests.patch(url, json=payload, headers=headers, timeout=5)
            update_job_progress(order_id, pages_printed, cups_job_id, status)
        except Exception as e:
            logger.warning(f"Failed to report progress for {order_id}: {e}")

    def report_complete(self, order_id: str, pages_printed: int, cups_job_id: str = None):
        """POST cloud API completion."""
        url = f"{CLOUD_API_URL}/api/device/jobs/{order_id}?action=complete"
        headers = get_auth_headers()
        headers["Content-Type"] = "application/json"
        try:
            requests.post(url, json={"pagesPrinted": pages_printed, "cupsJobId": cups_job_id}, headers=headers, timeout=10)
        except Exception as e:
            logger.error(f"Failed to report completion for {order_id}: {e}")

    def report_failure(self, order_id: str, pages_printed: int, reason: str):
        """POST cloud API failure."""
        url = f"{CLOUD_API_URL}/api/device/jobs/{order_id}?action=fail"
        headers = get_auth_headers()
        headers["Content-Type"] = "application/json"
        try:
            requests.post(url, json={"pagesPrinted": pages_printed, "reason": reason}, headers=headers, timeout=10)
        except Exception as e:
            logger.error(f"Failed to report failure for {order_id}: {e}")

    def secure_delete_file(self, file_path: str):
        """Forensic overwrite and shred document from local disk for absolute privacy."""
        try:
            if os.path.exists(file_path):
                file_size = os.path.getsize(file_path)
                with open(file_path, "wb") as f:
                    f.write(b"\x00" * file_size)
                os.remove(file_path)
                logger.debug(f"Securely shredded local document: {file_path}")
        except Exception as e:
            logger.warning(f"Error securely deleting {file_path}: {e}")

    def run(self):
        """Main service loop."""
        logger.info(f"PrintBar Raspberry Pi Agent started for device: {DEVICE_ID}")
        logger.info(f"Connecting to Cloud API: {CLOUD_API_URL}")

        while True:
            try:
                self.send_heartbeat()
                self.poll_and_execute_commands()
                self.poll_and_process_jobs()
            except Exception as e:
                logger.error(f"Unexpected exception in agent loop: {e}")

            time.sleep(POLL_INTERVAL_SECONDS)

if __name__ == "__main__":
    agent = PrintBarAgent()
    agent.run()
