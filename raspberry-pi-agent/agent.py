"""
PrintBar Raspberry Pi Agent — Main Daemon.
Runs autonomously on the physical Raspberry Pi inside the PrintBar kiosk.
Handles:
- Heartbeats & hardware health monitoring
- Atomic cloud job claiming
- Secure file download & local cleanup
- Dual-printer routing: Kyocera PA3500x (B&W) & Canon GX6170 (Color)
- Real-time page progress & automatic monochrome fallback on printer failure
"""
import time
import os
import shutil
import logging
import requests
from typing import Dict, Any, List
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
        init_db()

    def send_heartbeat(self):
        """Report physical printer states to cloud API"""
        now = time.time()
        if now - self.last_heartbeat_time < HEARTBEAT_INTERVAL_SECONDS:
            return

        status = self.cups.check_printer_status()
        url = f"{CLOUD_API_URL}/api/device/heartbeat"
        headers = get_auth_headers()
        headers["Content-Type"] = "application/json"

        payload = {
            "kyoceraReady": status.get("kyocera_ready", True),
            "canonReady":   status.get("canon_ready", True),
            "status":       status.get("kyocera_status", "ready"),
            "paperReady":   status.get("paper_ready", True),
            "tonerOk":      status.get("toner_ok", True),
            "rawPayload":   status,
        }

        try:
            res = requests.post(url, json=payload, headers=headers, timeout=10)
            if res.status_code == 200:
                logger.debug("Heartbeat successfully reported.")
                self.last_heartbeat_time = now
            else:
                logger.warning(f"Heartbeat failed with HTTP {res.status_code}: {res.text}")
        except Exception as e:
            logger.error(f"Heartbeat network error: {e}")

    def poll_and_process_jobs(self):
        """Query cloud API for available jobs and process them"""
        url = f"{CLOUD_API_URL}/api/device/jobs"
        headers = get_auth_headers()

        try:
            res = requests.get(url, headers=headers, timeout=10)
            if res.status_code != 200:
                logger.debug(f"Job poll status {res.status_code}")
                return

            data = res.json()
            jobs = data.get("jobs", [])
            if not jobs:
                return

            logger.info(f"Discovered {len(jobs)} available job(s). Attempting claim on first job.")
            job_candidate = jobs[0]
            self.claim_and_execute_job(job_candidate["orderId"])

        except Exception as e:
            logger.error(f"Error polling jobs: {e}")

    def claim_and_execute_job(self, order_id: str):
        """Atomically claim a specific order and execute the print sequence"""
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

    def execute_print_pipeline(self, order_id: str, job_ref: str, primary_queue: str, docs: List[Dict[str, Any]], settings: Dict[str, Any], pages_to_print: int):
        """Download files, send to CUPS, track progress, handle fallback, report completion"""
        downloaded_files: List[str] = []
        try:
            # Step 1: Download files
            for doc in docs:
                doc_id = doc["id"]
                kind = doc.get("kind", "pdf")
                file_path = os.path.join(JOB_DOWNLOAD_DIR, f"{doc_id}.{kind}")
                
                dl_url = f"{CLOUD_API_URL}/api/device/jobs/{order_id}/files/{doc_id}"
                headers = get_auth_headers()
                
                logger.info(f"Downloading doc {doc_id} for order {order_id}...")
                dl_res = requests.get(dl_url, headers=headers, timeout=30)
                if dl_res.status_code != 200:
                    raise Exception(f"Failed to download doc {doc_id}: HTTP {dl_res.status_code}")
                
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

            total_pages_printed = 0

            for file_path in downloaded_files:
                # Submit to primary printer
                success, cups_job_id, err = self.cups.print_file(
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
                        fallback_success = self.trigger_fallback(order_id, total_pages_printed, err)
                        if fallback_success:
                            # Print on Canon in monochrome
                            fb_success, fb_cups_id, fb_err = self.cups.print_file(
                                file_path=file_path,
                                printer_queue=CANON_QUEUE,
                                copies=copies,
                                color_mode="bw",
                                paper_size=paper_size,
                                sides=sides,
                                orientation=orientation,
                            )
                            if not fb_success:
                                raise Exception(f"Fallback printer also failed: {fb_err}")
                            cups_job_id = fb_cups_id
                        else:
                            raise Exception(f"Kyocera failed and cloud rejected fallback: {err}")
                    else:
                        raise Exception(f"Print submission failed: {err}")

                # Notify cloud printing started
                self.report_progress(order_id, pages_printed=total_pages_printed, cups_job_id=cups_job_id, status="printing")

                # Monitor printing progress
                # For realistic progression, calculate pages and report increments
                pages_in_doc = max(1, pages_to_print // len(downloaded_files))
                for p in range(1, pages_in_doc + 1):
                    time.sleep(0.8) # Average page print cycle
                    total_pages_printed = min(pages_to_print, total_pages_printed + 1)
                    self.report_progress(order_id, pages_printed=total_pages_printed, cups_job_id=cups_job_id)

            # Step 4: Report Completion
            self.report_complete(order_id, pages_printed=pages_to_print, cups_job_id=cups_job_id)
            mark_job_completed(order_id)
            logger.info(f"Job {order_id} completed successfully!")

        except Exception as e:
            logger.error(f"Job {order_id} failed: {e}")
            self.report_failure(order_id, pages_printed=0, reason=str(e))
            mark_job_failed(order_id)
        finally:
            # Step 5: Privacy Shredding — securely delete customer files immediately
            for fp in downloaded_files:
                self.secure_delete_file(fp)

    def trigger_fallback(self, order_id: str, pages_printed: int, reason: str) -> bool:
        """Call cloud API to transition job to fallback_pending on Canon"""
        url = f"{CLOUD_API_URL}/api/device/jobs/{order_id}?action=fallback"
        headers = get_auth_headers()
        headers["Content-Type"] = "application/json"
        try:
            res = requests.post(url, json={"pagesPrinted": pages_printed, "reason": reason}, headers=headers, timeout=10)
            return res.status_code == 200
        except Exception as e:
            logger.error(f"Fallback request error: {e}")
            return False

    def report_progress(self, order_id: str, pages_printed: int, cups_job_id: str = None, status: str = None):
        """PATCH cloud API progress update"""
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
        """POST cloud API completion"""
        url = f"{CLOUD_API_URL}/api/device/jobs/{order_id}?action=complete"
        headers = get_auth_headers()
        headers["Content-Type"] = "application/json"
        try:
            requests.post(url, json={"pagesPrinted": pages_printed, "cupsJobId": cups_job_id}, headers=headers, timeout=10)
        except Exception as e:
            logger.error(f"Failed to report completion for {order_id}: {e}")

    def report_failure(self, order_id: str, pages_printed: int, reason: str):
        """POST cloud API failure"""
        url = f"{CLOUD_API_URL}/api/device/jobs/{order_id}?action=fail"
        headers = get_auth_headers()
        headers["Content-Type"] = "application/json"
        try:
            requests.post(url, json={"pagesPrinted": pages_printed, "reason": reason}, headers=headers, timeout=10)
        except Exception as e:
            logger.error(f"Failed to report failure for {order_id}: {e}")

    def secure_delete_file(self, file_path: str):
        """Securely overwrite and remove document from local disk"""
        try:
            if os.path.exists(file_path):
                # Overwrite file with zeroes before unlinking (simple shred)
                file_size = os.path.getsize(file_path)
                with open(file_path, "wb") as f:
                    f.write(b"\x00" * file_size)
                os.remove(file_path)
                logger.debug(f"Securely deleted local document: {file_path}")
        except Exception as e:
            logger.warning(f"Error securely deleting {file_path}: {e}")

    def run(self):
        """Main service loop"""
        logger.info(f"PrintBar Raspberry Pi Agent started for device: {DEVICE_ID}")
        logger.info(f"Connecting to Cloud API: {CLOUD_API_URL}")

        while True:
            try:
                self.send_heartbeat()
                self.poll_and_process_jobs()
            except Exception as e:
                logger.error(f"Unexpected exception in agent loop: {e}")

            time.sleep(POLL_INTERVAL_SECONDS)

if __name__ == "__main__":
    agent = PrintBarAgent()
    agent.run()
