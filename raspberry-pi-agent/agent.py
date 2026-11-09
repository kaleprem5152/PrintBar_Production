"""
PrintBar Raspberry Pi Agent — Production Autonomous Daemon v3.0.

Runs on the physical Raspberry Pi 5 inside the PrintBar kiosk (PB-K01).
Handles:
  - Config validation at startup (refuses to run with weak/missing secrets)
  - Startup job recovery (orphaned CUPS jobs after reboot)
  - Authentic hardware telemetry (CPU temp, CPU%, RAM%, disk%)
  - Real-time printer status via PrinterMonitor (IPP + CUPS)
  - Durable outbox: cloud API calls are persisted before sending
  - Remote admin command polling & idempotent execution
  - Atomic cloud job claiming with idempotency key
  - Secure file download to per-job isolated directory (0700)
  - Print attempt history (db.print_attempts)
  - Dual-printer routing with precise partial-page failover
  - Forensic document shredding (3-pass overwrite) on completion/failure
  - Paper inventory tracking (blocked if out-of-paper)
"""
import time
import os
import sys
import json
import uuid
import shutil
import logging
import requests
from pathlib import Path
from typing import Dict, Any, List, Optional

from config import (
    CLOUD_API_URL,
    DEVICE_ID,
    KYOCERA_IP,
    CANON_IP,
    KYOCERA_QUEUE,
    CANON_QUEUE,
    KYOCERA_PORT,
    CANON_PORT,
    POLL_INTERVAL_SECONDS,
    HEARTBEAT_INTERVAL_SECONDS,
    COMMAND_POLL_INTERVAL,
    DOCUMENT_STORAGE_DIR,
    LOG_LEVEL,
    PRODUCTION_MODE,
    validate_config,
)
from auth import get_auth_headers
from db import (
    init_db,
    record_job_claimed,
    update_job_progress,
    mark_job_completed,
    mark_job_failed,
    get_active_job,
    get_incomplete_jobs,
    record_print_attempt,
    update_print_attempt,
    save_outbox_event,
    get_pending_outbox,
    mark_outbox_synced,
    increment_outbox_retry,
    record_command,
    complete_command,
    command_already_executed,
    cleanup_old_nonces,
    record_printer_state,
)
from cups_manager import CupsManager
from printer_monitor import PrinterMonitor

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("printbar.agent")

AGENT_VERSION = "3.0.0"


class PrintBarAgent:
    def __init__(self):
        # Validate configuration before anything else
        validate_config()

        self.cups    = CupsManager()
        self.monitor = PrinterMonitor(
            kyocera_ip=KYOCERA_IP,
            canon_ip=CANON_IP,
            kyocera_queue=KYOCERA_QUEUE,
            canon_queue=CANON_QUEUE,
        )

        self.last_heartbeat_time     = 0.0
        self.last_command_poll_time  = 0.0
        self.last_outbox_flush_time  = 0.0
        self.last_nonce_cleanup_time = 0.0

        # Paper counts — authoritative source is cloud heartbeat response
        self.kyocera_paper   = 250
        self.canon_paper     = 250
        self.paper_ready     = True
        self.maintenance_mode = False

        # Printer states cache
        self._kyocera_state: Dict[str, Any] = {}
        self._canon_state:   Dict[str, Any] = {}

        # Initialise database (runs migrations)
        init_db()

        logger.info("PrintBar Agent %s starting — Device: %s — Mode: %s",
                    AGENT_VERSION, DEVICE_ID, "PRODUCTION" if PRODUCTION_MODE else "development")

        # Recover any incomplete jobs from before last reboot
        self._recover_incomplete_jobs()

    # ------------------------------------------------------------------
    # Startup Recovery
    # ------------------------------------------------------------------

    def _recover_incomplete_jobs(self) -> None:
        """
        On startup, find jobs that were claimed/processing when the Pi last stopped.
        Mark them as 'recovery_needed' and report failure to the cloud so the
        backend can decide whether to refund, retry, or leave for manual review.
        """
        jobs = get_incomplete_jobs()
        if not jobs:
            return

        logger.warning("Found %d incomplete job(s) from previous session — reporting to cloud.", len(jobs))
        for job in jobs:
            order_id = job["order_id"]
            pages_done = job.get("pages_printed", 0)
            logger.warning("Recovering job %s (status=%s, pages_printed=%d)",
                           order_id, job.get("status"), pages_done)
            # Report as failed — cloud decides next step
            self._report_failure(
                order_id,
                pages_printed=pages_done,
                reason=f"Agent restarted during job execution (recovery at startup). "
                       f"Sheets physically printed before restart: {job.get('physical_sheets', 0)}",
            )
            mark_job_failed(order_id, "recovered_at_startup")

    # ------------------------------------------------------------------
    # Telemetry
    # ------------------------------------------------------------------

    def get_system_telemetry(self) -> Dict[str, Any]:
        """Collect real Raspberry Pi 5 hardware metrics without synthetic mocking."""
        t: Dict[str, Any] = {
            "tempC":   None,
            "cpuPct":  None,
            "memPct":  None,
            "diskPct": None,
        }

        # Thermal zone
        try:
            tf = "/sys/class/thermal/thermal_zone0/temp"
            if os.path.exists(tf):
                with open(tf) as f:
                    t["tempC"] = round(float(f.read().strip()) / 1000.0, 1)
        except Exception:
            pass

        # Disk usage
        try:
            u = shutil.disk_usage("/")
            t["diskPct"] = round((u.used / u.total) * 100)
        except Exception:
            try:
                u = shutil.disk_usage(str(DOCUMENT_STORAGE_DIR))
                t["diskPct"] = round((u.used / u.total) * 100)
            except Exception:
                pass

        # CPU + RAM
        try:
            import psutil
            t["cpuPct"] = round(psutil.cpu_percent(interval=None))
            t["memPct"] = round(psutil.virtual_memory().percent)
            if t["tempC"] is None and hasattr(psutil, "sensors_temperatures"):
                temps = psutil.sensors_temperatures()
                for key in ("cpu_thermal", "coretemp", "cpu-thermal"):
                    if key in temps and temps[key]:
                        t["tempC"] = round(temps[key][0].current, 1)
                        break
        except ImportError:
            try:
                if os.path.exists("/proc/loadavg"):
                    with open("/proc/loadavg") as f:
                        load1 = float(f.read().split()[0])
                    t["cpuPct"] = min(100, round((load1 / 4.0) * 100))
                if os.path.exists("/proc/meminfo"):
                    with open("/proc/meminfo") as f:
                        lines = f.readlines()
                    total = free = 0
                    for line in lines:
                        if "MemTotal" in line:
                            total = int(line.split()[1])
                        elif "MemAvailable" in line:
                            free = int(line.split()[1])
                    if total > 0:
                        t["memPct"] = round(((total - free) / total) * 100)
            except Exception:
                pass

        return t

    # ------------------------------------------------------------------
    # Heartbeat
    # ------------------------------------------------------------------

    def send_heartbeat(self) -> None:
        """Report hardware telemetry and printer states to both backend endpoints."""
        now = time.time()
        if now - self.last_heartbeat_time < HEARTBEAT_INTERVAL_SECONDS:
            return

        telemetry = self.get_system_telemetry()

        # Refresh printer states
        printer_states = self.monitor.get_all_printer_status()
        self._kyocera_state = printer_states.get("kyocera", {})
        self._canon_state   = printer_states.get("canon", {})

        # Persist printer state snapshots
        try:
            record_printer_state("kyocera", self._kyocera_state.get("state", "UNKNOWN"), "monitor", self._kyocera_state)
            record_printer_state("canon",   self._canon_state.get("state", "UNKNOWN"),   "monitor", self._canon_state)
        except Exception:
            pass

        kyocera_ready = self._kyocera_state.get("state") in ("READY", "PRINTING")
        canon_ready   = self._canon_state.get("state") in ("READY", "PRINTING")

        # --- /api/device/heartbeat ---
        device_payload = {
            "kyoceraReady":  kyocera_ready,
            "canonReady":    canon_ready,
            "kyoceraStatus": self._kyocera_state.get("state", "UNKNOWN"),
            "canonStatus":   self._canon_state.get("state", "UNKNOWN"),
            "cupsReachable": self._kyocera_state.get("source") != "none" or self._canon_state.get("source") != "none",
            "agentVersion":  AGENT_VERSION,
            "paperReady":    (self.kyocera_paper > 0 or self.canon_paper > 0) and self.paper_ready,
            "tonerOk":       True,
        }
        try:
            body_bytes = json.dumps(device_payload).encode()
            headers = get_auth_headers(body_bytes)
            res = requests.post(
                f"{CLOUD_API_URL}/api/device/heartbeat",
                data=body_bytes, headers=headers, timeout=10
            )
            if res.status_code == 200:
                hb = res.json()
                self.kyocera_paper    = hb.get("kyoceraPaper", self.kyocera_paper)
                self.canon_paper      = hb.get("canonPaper", self.canon_paper)
                self.paper_ready      = hb.get("paperReady", True)
                self.maintenance_mode = hb.get("maintenanceMode", False)
            else:
                logger.warning("Device heartbeat returned %d", res.status_code)
        except Exception as exc:
            logger.warning("Device heartbeat network error: %s", exc)

        # --- /api/agent/heartbeat ---
        admin_payload = {
            "kioskId": DEVICE_ID,
            "softwareVersion": AGENT_VERSION,
            "networkType": "ethernet",
            "pi": telemetry,
            "printers": [
                {
                    "id":             "kyocera_pa3500x",
                    "queue":          KYOCERA_QUEUE,
                    "connected":      kyocera_ready,
                    "state":          self._kyocera_state.get("state", "UNKNOWN"),
                    "paperRemaining": self.kyocera_paper,
                    "errorMessage":   self._kyocera_state.get("reason") if not kyocera_ready else None,
                },
                {
                    "id":             "canon_gx6170",
                    "queue":          CANON_QUEUE,
                    "connected":      canon_ready,
                    "state":          self._canon_state.get("state", "UNKNOWN"),
                    "paperRemaining": self.canon_paper,
                    "errorMessage":   self._canon_state.get("reason") if not canon_ready else None,
                },
            ],
        }
        try:
            body_bytes2 = json.dumps(admin_payload).encode()
            headers2 = get_auth_headers(body_bytes2)
            requests.post(
                f"{CLOUD_API_URL}/api/agent/heartbeat",
                data=body_bytes2, headers=headers2, timeout=10
            )
        except Exception as exc:
            logger.debug("Admin heartbeat notice: %s", exc)

        self.last_heartbeat_time = now

    # ------------------------------------------------------------------
    # Durable Outbox Flush
    # ------------------------------------------------------------------

    def flush_outbox(self) -> None:
        """Retry pending cloud API calls that failed during job processing."""
        now = time.time()
        if now - self.last_outbox_flush_time < 15:
            return
        self.last_outbox_flush_time = now

        events = get_pending_outbox(limit=10)
        for ev in events:
            try:
                payload = json.loads(ev["payload_json"])
                url     = payload.pop("_url")
                method  = payload.pop("_method", "POST").upper()
                body    = json.dumps(payload).encode()
                headers = get_auth_headers(body)
                if method == "PATCH":
                    r = requests.patch(url, data=body, headers=headers, timeout=8)
                else:
                    r = requests.post(url, data=body, headers=headers, timeout=8)
                if r.status_code < 500:
                    mark_outbox_synced(ev["id"])
                else:
                    increment_outbox_retry(ev["id"], f"HTTP {r.status_code}")
            except Exception as exc:
                increment_outbox_retry(ev["id"], str(exc))

    # ------------------------------------------------------------------
    # Command Polling
    # ------------------------------------------------------------------

    def poll_and_execute_commands(self) -> None:
        """Poll and execute operator commands from the Admin Control Centre."""
        now = time.time()
        if now - self.last_command_poll_time < COMMAND_POLL_INTERVAL:
            return
        self.last_command_poll_time = now

        try:
            headers = get_auth_headers()
            res = requests.get(
                f"{CLOUD_API_URL}/api/agent/commands?kioskId={DEVICE_ID}",
                headers=headers, timeout=10
            )
            if res.status_code != 200:
                return
            for cmd in res.json().get("commands", []):
                self._execute_command(cmd)
        except Exception as exc:
            logger.debug("Command poll error: %s", exc)

    def _execute_command(self, cmd: Dict[str, Any]) -> None:
        cmd_id = str(cmd.get("id", ""))
        action = cmd.get("command", "")
        printer_id = cmd.get("printerId", "")
        payload    = cmd.get("payload") or {}

        # Idempotent — skip if already executed
        if cmd_id and command_already_executed(cmd_id):
            return
        if cmd_id:
            record_command(cmd_id, action)

        logger.info("Executing command #%s: %s (printer: %s)", cmd_id, action, printer_id)

        status     = "succeeded"
        result_msg = ""

        try:
            target_queue = CANON_QUEUE if printer_id and "canon" in printer_id.lower() else KYOCERA_QUEUE

            if action == "test_print":
                ok, cups_id, err = self.cups.print_test_page(target_queue)
                result_msg = f"Test page sent to {target_queue} (CUPS: {cups_id})" if ok else f"Test print failed: {err}"
                if not ok:
                    status = "failed"

            elif action == "fetch_cups_queue":
                items = self.cups.get_cups_queue(target_queue)
                result_msg = f"Queue {target_queue}: {len(items)} job(s) pending."

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

            elif action == "run_diagnostics" or action == "refresh_status":
                states = self.monitor.get_all_printer_status()
                telem  = self.get_system_telemetry()
                result_msg = (
                    f"K:{states['kyocera'].get('state')} C:{states['canon'].get('state')} "
                    f"Temp:{telem.get('tempC')}C CPU:{telem.get('cpuPct')}% "
                    f"Paper K:{self.kyocera_paper} C:{self.canon_paper}"
                )

            elif action == "refill_paper":
                target_printer = payload.get("printer", "both")
                amount = int(payload.get("amount", 250))
                if target_printer in ("kyocera", "both"):
                    self.kyocera_paper = amount
                if target_printer in ("canon", "both"):
                    self.canon_paper = amount
                self.paper_ready = True
                result_msg = f"Paper refilled: {target_printer} → {amount} sheets."

            elif action == "cancel_job":
                job_id = payload.get("cupsJobId", "")
                ok = self.cups.cancel_job(job_id) if job_id else False
                result_msg = f"Cancelled CUPS job {job_id}." if ok else f"Could not cancel {job_id}."
                if not ok:
                    status = "failed"

            elif action == "restart_agent":
                result_msg = "Agent restarting via systemd watchdog..."
                self._acknowledge_command(cmd_id, status, result_msg)
                if cmd_id:
                    complete_command(cmd_id, status, {"result": result_msg})
                time.sleep(1)
                os.execv(sys.executable, [sys.executable] + sys.argv)
                return

            else:
                result_msg = f"Unknown command '{action}' — ignored."
                status = "failed"

        except Exception as exc:
            status = "failed"
            result_msg = f"Exception executing '{action}': {exc}"
            logger.error(result_msg)

        self._acknowledge_command(cmd_id, status, result_msg)
        if cmd_id:
            complete_command(cmd_id, status, {"result": result_msg})

    def _acknowledge_command(self, cmd_id: str, status: str, result: str) -> None:
        if not cmd_id:
            return
        try:
            body = json.dumps({"status": status, "result": result[:500]}).encode()
            headers = get_auth_headers(body)
            requests.post(
                f"{CLOUD_API_URL}/api/agent/commands/{cmd_id}",
                data=body, headers=headers, timeout=10
            )
        except Exception as exc:
            logger.warning("Could not acknowledge command #%s: %s", cmd_id, exc)

    # ------------------------------------------------------------------
    # Job Polling
    # ------------------------------------------------------------------

    def poll_and_process_jobs(self) -> None:
        """Query cloud API for available paid jobs and process them."""
        if self.maintenance_mode:
            return

        # Paper check — block if neither printer has paper
        if self.kyocera_paper <= 0 and self.canon_paper <= 0:
            logger.warning("Both printers are out of paper — blocking job polling until refilled.")
            return

        try:
            headers = get_auth_headers()
            res = requests.get(f"{CLOUD_API_URL}/api/device/jobs", headers=headers, timeout=10)
            if res.status_code != 200:
                return
            jobs = res.json().get("jobs", [])
            if not jobs:
                return
            self._claim_and_execute_job(jobs[0]["orderId"])
        except Exception as exc:
            logger.error("Error polling jobs: %s", exc)

    def _claim_and_execute_job(self, order_id: str) -> None:
        """Atomically claim an order and execute the full print pipeline."""
        idempotency_key = f"{order_id}-{DEVICE_ID}"
        body = json.dumps({"orderId": order_id, "idempotencyKey": idempotency_key}).encode()
        headers = get_auth_headers(body)

        try:
            res = requests.post(
                f"{CLOUD_API_URL}/api/device/jobs",
                data=body, headers=headers, timeout=10
            )
            if res.status_code != 200:
                logger.info("Could not claim job %s: %s", order_id, res.text[:200])
                return

            claim = res.json()
            job_ref       = claim["jobRef"]
            settings      = claim["settings"]
            docs          = claim["docs"]
            pages_to_print = claim["pagesToPrint"]
            color_mode    = settings.get("colorMode", "bw")
            copies        = int(settings.get("copies", 1))
            sides         = settings.get("sides", "single")
            pages_per_sheet = int(settings.get("pagesPerSheet", 1))

            # Route printer
            primary_queue = CANON_QUEUE if color_mode == "color" else KYOCERA_QUEUE
            logger.info("Claimed job %s (%s) → %s | pages=%d copies=%d",
                        order_id, job_ref, primary_queue, pages_to_print, copies)

            record_job_claimed(
                order_id, job_ref, primary_queue, pages_to_print,
                color_mode, copies, settings,
                idempotency_key=idempotency_key,
                sided=sides,
                pages_per_sheet=pages_per_sheet,
            )
            self._execute_print_pipeline(order_id, job_ref, primary_queue, docs, settings, pages_to_print)

        except Exception as exc:
            logger.error("Error claiming job %s: %s", order_id, exc)

    # ------------------------------------------------------------------
    # Print Pipeline
    # ------------------------------------------------------------------

    def _execute_print_pipeline(
        self,
        order_id: str,
        job_ref: str,
        primary_queue: str,
        docs: List[Dict[str, Any]],
        settings: Dict[str, Any],
        pages_to_print: int,
    ) -> None:
        """
        Download files → verify printer ready → submit to CUPS →
        monitor authentic progress → handle failover → report completion →
        shred files.
        """
        # Create isolated per-job directory (0700)
        job_dir = DOCUMENT_STORAGE_DIR / uuid.uuid4().hex
        job_dir.mkdir(mode=0o700, parents=True, exist_ok=True)

        downloaded_files: List[str] = []
        total_pages_printed = 0
        cups_job_id: Optional[str] = None
        attempt_id: Optional[int] = None
        attempt_no = 0

        color_mode   = settings.get("colorMode", "bw")
        copies       = int(settings.get("copies", 1))
        paper_size   = settings.get("paperSize", "A4")
        sides        = settings.get("sides", "single")
        orientation  = settings.get("orientation", "portrait")

        try:
            # ── Step 1: Verify printer is ready BEFORE downloading ──
            printer_id = "canon" if primary_queue == CANON_QUEUE else "kyocera"
            ready, reason = self.monitor.is_printer_ready(printer_id)
            if not ready:
                # Try fallback for B&W before giving up
                if color_mode == "bw" and primary_queue == KYOCERA_QUEUE:
                    ready_fb, reason_fb = self.monitor.is_printer_ready("canon")
                    if ready_fb:
                        logger.warning("Kyocera not ready (%s) — routing B&W to Canon.", reason)
                        primary_queue = CANON_QUEUE
                    else:
                        raise RuntimeError(
                            f"Kyocera not ready: {reason}. Canon fallback also not ready: {reason_fb}"
                        )
                elif color_mode == "color":
                    raise RuntimeError(f"Canon not ready for colour job: {reason}")
                else:
                    raise RuntimeError(f"Printer {primary_queue} not ready: {reason}")

            # ── Step 2: Download files ──
            for doc in docs:
                doc_id = doc["id"]
                dl_url = f"{CLOUD_API_URL}/api/device/jobs/{order_id}/files/{doc_id}"
                headers = get_auth_headers()
                logger.info("Downloading doc %s for order %s...", doc_id, order_id)
                dl_res = requests.get(dl_url, headers=headers, timeout=60, stream=True)
                if dl_res.status_code != 200:
                    raise RuntimeError(f"Failed to download doc {doc_id}: HTTP {dl_res.status_code}")

                ct = dl_res.headers.get("Content-Type", "")
                ext = "pdf" if "pdf" in ct else doc.get("kind", "pdf")
                file_path = str(job_dir / f"{doc_id}.{ext}")
                with open(file_path, "wb") as fh:
                    for chunk in dl_res.iter_content(chunk_size=65536):
                        fh.write(chunk)
                os.chmod(file_path, 0o600)
                downloaded_files.append(file_path)

            # ── Step 3: Notify cloud ──
            self._report_progress(order_id, 0, status="processing")

            # ── Step 4: Print each file ──
            for file_path in downloaded_files:
                attempt_no += 1
                attempt_id = record_print_attempt(order_id, attempt_no, primary_queue)

                # Deduct paper
                if primary_queue == KYOCERA_QUEUE:
                    self.kyocera_paper = max(0, self.kyocera_paper - pages_to_print)
                else:
                    self.canon_paper = max(0, self.canon_paper - pages_to_print)

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
                    if attempt_id:
                        update_print_attempt(attempt_id, result="failed", error_msg=err, ended=True)

                    if color_mode == "bw" and primary_queue == KYOCERA_QUEUE:
                        logger.warning("Kyocera failed (%s) — falling back to Canon.", err)
                        ok = self._report_fallback(order_id, total_pages_printed, err, cups_job_id)
                        if ok:
                            primary_queue = CANON_QUEUE
                            attempt_no += 1
                            attempt_id = record_print_attempt(order_id, attempt_no, CANON_QUEUE)
                            success, cups_job_id, err = self.cups.print_file(
                                file_path=file_path,
                                printer_queue=CANON_QUEUE,
                                copies=copies,
                                color_mode="bw",
                                paper_size=paper_size,
                                sides=sides,
                                orientation=orientation,
                            )
                            if not success:
                                raise RuntimeError(f"Fallback to Canon also failed: {err}")
                        else:
                            raise RuntimeError(f"Kyocera failed and cloud rejected fallback: {err}")
                    else:
                        raise RuntimeError(f"Print submission failed: {err}")

                if attempt_id:
                    update_print_attempt(attempt_id, cups_job_id=cups_job_id, cups_state="pending")

                update_job_progress(order_id, 0, cups_job_id=cups_job_id, status="printing")
                self._report_progress(order_id, 0, cups_job_id=cups_job_id, status="printing")

                # ── Step 5: Monitor CUPS progress ──
                doc_impressions = 0
                poll_start      = time.time()
                timeout_secs    = max(120, pages_to_print * copies * 25)

                while time.time() - poll_start < timeout_secs:
                    prog  = self.cups.get_job_progress(cups_job_id)
                    state = prog.get("state", "processing")
                    impr  = prog.get("impressions_completed", 0)
                    phys  = prog.get("sheets_completed", 0)

                    if impr > doc_impressions:
                        delta = impr - doc_impressions
                        doc_impressions = impr
                        total_pages_printed = min(pages_to_print, total_pages_printed + delta)
                        update_job_progress(
                            order_id, total_pages_printed,
                            cups_job_id=cups_job_id,
                            physical_sheets=phys,
                        )
                        self._report_progress(order_id, total_pages_printed, cups_job_id=cups_job_id)
                        if attempt_id:
                            update_print_attempt(
                                attempt_id,
                                cups_state=state,
                                pages_printed=total_pages_printed,
                                sheets_printed=phys,
                            )

                    if state == "completed":
                        logger.info("CUPS job %s completed.", cups_job_id)
                        total_pages_printed = pages_to_print
                        if attempt_id:
                            update_print_attempt(
                                attempt_id, cups_state="completed",
                                result="completed",
                                pages_printed=total_pages_printed,
                                sheets_printed=phys,
                                ended=True,
                            )
                        break

                    elif state in ("stopped", "canceled", "aborted"):
                        if attempt_id:
                            update_print_attempt(
                                attempt_id, cups_state=state,
                                result="failed", error_msg=f"CUPS state: {state}",
                                pages_printed=total_pages_printed, ended=True
                            )
                        # Mid-print failure on Kyocera → partial failover
                        if color_mode == "bw" and primary_queue == KYOCERA_QUEUE and total_pages_printed < pages_to_print:
                            logger.warning(
                                "Kyocera halted at page %d/%d — routing remainder to Canon.",
                                total_pages_printed, pages_to_print
                            )
                            self.cups.cancel_job(cups_job_id)
                            rem_start = total_pages_printed + 1
                            rem_range = f"{rem_start}-{pages_to_print}"
                            self._report_fallback(
                                order_id, total_pages_printed,
                                f"Interrupted at page {total_pages_printed}", cups_job_id
                            )
                            attempt_no += 1
                            attempt_id = record_print_attempt(order_id, attempt_no, CANON_QUEUE)
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
                                cups_job_id  = fb_id
                                primary_queue = CANON_QUEUE
                                doc_impressions = 0
                                poll_start = time.time()
                                continue
                            else:
                                raise RuntimeError(f"Partial failover to Canon failed: {fb_err}")

                        raise RuntimeError(
                            f"CUPS job {cups_job_id} ended in state '{state}' at page {total_pages_printed}/{pages_to_print}"
                        )

                    time.sleep(1.5)

            # ── Step 6: Report completion ──
            self._report_complete(order_id, pages_to_print, cups_job_id)
            mark_job_completed(order_id)
            logger.info("Job %s completed successfully (%d pages).", order_id, pages_to_print)

        except Exception as exc:
            logger.error("Job %s failed: %s", order_id, exc)
            if attempt_id:
                update_print_attempt(attempt_id, result="failed", error_msg=str(exc), ended=True)
            self._report_failure(order_id, total_pages_printed, str(exc))
            mark_job_failed(order_id, str(exc))

        finally:
            # ── Step 7: Forensic shredding (3-pass) ──
            for fp in downloaded_files:
                self._secure_delete(fp)
            # Remove job directory
            try:
                if job_dir.exists():
                    shutil.rmtree(str(job_dir), ignore_errors=True)
            except Exception:
                pass

    # ------------------------------------------------------------------
    # Cloud Report Helpers (with outbox fallback)
    # ------------------------------------------------------------------

    def _cloud_post(self, url: str, payload: Dict[str, Any], method: str = "POST") -> bool:
        """POST/PATCH to cloud. If it fails, save to outbox for retry."""
        outbox_payload = dict(payload)
        outbox_payload["_url"] = url
        outbox_payload["_method"] = method
        ev_id = save_outbox_event("cloud_report", payload.get("orderId"), outbox_payload)
        try:
            body = json.dumps(payload).encode()
            headers = get_auth_headers(body)
            if method == "PATCH":
                r = requests.patch(url, data=body, headers=headers, timeout=8)
            else:
                r = requests.post(url, data=body, headers=headers, timeout=8)
            if r.status_code < 500:
                mark_outbox_synced(ev_id)
                return True
            else:
                increment_outbox_retry(ev_id, f"HTTP {r.status_code}")
                return False
        except Exception as exc:
            increment_outbox_retry(ev_id, str(exc))
            return False

    def _report_progress(self, order_id: str, pages_printed: int,
                         cups_job_id: Optional[str] = None,
                         status: Optional[str] = None) -> None:
        payload: Dict[str, Any] = {"pagesPrinted": pages_printed, "orderId": order_id}
        if cups_job_id:
            payload["cupsJobId"] = cups_job_id
        if status:
            payload["status"] = status
        self._cloud_post(f"{CLOUD_API_URL}/api/device/jobs/{order_id}", payload, method="PATCH")

    def _report_fallback(self, order_id: str, pages_printed: int,
                         reason: str, prev_cups_id: Optional[str]) -> bool:
        payload: Dict[str, Any] = {
            "orderId": order_id,
            "pagesPrinted": pages_printed,
            "reason": reason,
        }
        if prev_cups_id:
            payload["previousCupsJobId"] = prev_cups_id
        return self._cloud_post(f"{CLOUD_API_URL}/api/device/jobs/{order_id}?action=fallback", payload)

    def _report_complete(self, order_id: str, pages_printed: int,
                         cups_job_id: Optional[str]) -> None:
        payload: Dict[str, Any] = {
            "orderId": order_id,
            "pagesPrinted": pages_printed,
            "cupsJobId": cups_job_id,
        }
        self._cloud_post(f"{CLOUD_API_URL}/api/device/jobs/{order_id}?action=complete", payload)

    def _report_failure(self, order_id: str, pages_printed: int, reason: str) -> None:
        payload: Dict[str, Any] = {
            "orderId": order_id,
            "pagesPrinted": pages_printed,
            "reason": reason[:500],
        }
        self._cloud_post(f"{CLOUD_API_URL}/api/device/jobs/{order_id}?action=fail", payload)

    # ------------------------------------------------------------------
    # Secure Delete
    # ------------------------------------------------------------------

    def _secure_delete(self, file_path: str) -> None:
        """3-pass overwrite then unlink — prevents file recovery."""
        try:
            if not os.path.exists(file_path):
                return
            size = os.path.getsize(file_path)
            if size == 0:
                os.remove(file_path)
                return
            with open(file_path, "r+b") as fh:
                # Pass 1: zeros
                fh.write(b"\x00" * size)
                fh.flush()
                os.fsync(fh.fileno())
                # Pass 2: ones
                fh.seek(0)
                fh.write(b"\xff" * size)
                fh.flush()
                os.fsync(fh.fileno())
                # Pass 3: random-ish pattern
                fh.seek(0)
                fh.write(b"\xa5" * size)
                fh.flush()
                os.fsync(fh.fileno())
            os.remove(file_path)
            logger.debug("Securely shredded: %s", file_path)
        except Exception as exc:
            logger.warning("Error securely deleting %s: %s", file_path, exc)

    # ------------------------------------------------------------------
    # Main Loop
    # ------------------------------------------------------------------

    def run(self) -> None:
        logger.info("Agent loop started — Device: %s  Cloud: %s", DEVICE_ID, CLOUD_API_URL)
        last_nonce_cleanup = 0.0

        while True:
            try:
                self.send_heartbeat()
                self.flush_outbox()
                self.poll_and_execute_commands()
                self.poll_and_process_jobs()

                # Periodic nonce table cleanup (every hour)
                now = time.time()
                if now - last_nonce_cleanup > 3600:
                    cleanup_old_nonces(3600)
                    last_nonce_cleanup = now

            except Exception as exc:
                logger.error("Unexpected exception in agent loop: %s", exc, exc_info=True)

            time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    PrintBarAgent().run()
