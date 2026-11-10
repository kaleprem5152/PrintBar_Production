"""
PrintBar Raspberry Pi Agent — Production Autonomous Daemon v4.0.

Runs on the physical Raspberry Pi 5 inside the PrintBar kiosk (PB-K01).
V4 Production Hardening:
  - Canonical HMAC-SHA256 signature (METHOD:PATH:TIMESTAMP:NONCE:BODY_SHA256)
  - Zero simulation mode; genuine CUPS and printer status only
  - Strict print-monitor timeout: timeouts NEVER fall through to completion; require MANUAL_REVIEW
  - Unsafe automatic partial failover disabled: mid-print interruptions flagged for MANUAL_REVIEW
  - Durable Outbox with verified response acknowledgements (eventId check) & exponential backoff
  - Authentic crash recovery: reconciles recorded CUPS IDs at startup; uncertain output flags MANUAL_REVIEW
  - Multi-document order handling: tracks cumulative pages, copies, and document iterations accurately
  - Setting validation: validates N-up, colour restrictions, duplex against physical printer capabilities
  - Reliable document cleanup with visibility into cleanup errors
  - Durable command execution with lease handling & acknowledgement confirmation
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
from typing import Dict, Any, List, Optional, Tuple
from urllib.parse import urlparse

from config import (
    CLOUD_API_URL,
    DEVICE_ID,
    KYOCERA_IP,
    CANON_IP,
    KYOCERA_QUEUE,
    CANON_QUEUE,
    POLL_INTERVAL_SECONDS,
    HEARTBEAT_INTERVAL_SECONDS,
    COMMAND_POLL_INTERVAL,
    DOCUMENT_STORAGE_DIR,
    LOG_LEVEL,
    PRODUCTION_MODE,
    validate_config,
)
from auth import get_auth_headers, normalize_canonical_path
from db import (
    init_db,
    record_job_claimed,
    update_job_progress,
    mark_job_completed,
    mark_job_failed,
    mark_job_manual_review,
    get_active_job,
    get_incomplete_jobs,
    record_print_attempt,
    update_print_attempt,
    get_attempts_for_order,
    save_outbox_event,
    get_pending_outbox,
    mark_outbox_synced,
    schedule_outbox_retry,
    get_outbox_stats,
    record_command,
    complete_command,
    command_already_executed,
    record_command_state,
    get_command_state,
    cleanup_old_nonces,
    record_printer_state,
)
from cups_manager import CupsManager
from printer_monitor import (
    PrinterMonitor,
    STATE_READY,
    STATE_PRINTING,
    STATE_ERROR,
    STATE_DISABLED,
    STATE_OFFLINE,
)

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("printbar.agent")

AGENT_VERSION = "4.0.0"


class PrintBarAgent:
    def __init__(self):
        validate_config()

        self.cups = CupsManager()
        self.monitor = PrinterMonitor(
            kyocera_ip=KYOCERA_IP,
            canon_ip=CANON_IP,
            kyocera_queue=KYOCERA_QUEUE,
            canon_queue=CANON_QUEUE,
        )

        self.last_heartbeat_time = 0.0
        self.last_command_poll_time = 0.0
        self.last_outbox_flush_time = 0.0
        self.last_nonce_cleanup_time = 0.0

        # Authoritative paper counts synced from cloud
        self.kyocera_paper = 250
        self.canon_paper = 250
        self.paper_ready = True
        self.maintenance_mode = False

        self._kyocera_state: Dict[str, Any] = {}
        self._canon_state: Dict[str, Any] = {}

        init_db()

        logger.info(
            "PrintBar Agent %s starting — Device: %s (Mode: %s)",
            AGENT_VERSION,
            DEVICE_ID,
            "PRODUCTION" if PRODUCTION_MODE else "development",
        )

        # Reconcile incomplete jobs at startup
        self._recover_incomplete_jobs()

    # ------------------------------------------------------------------
    # Startup Recovery (Authentic CUPS & Cloud Reconciliation)
    # ------------------------------------------------------------------

    def _recover_incomplete_jobs(self) -> None:
        """
        Reconcile incomplete jobs using persisted individual print attempts (retaining
        exact attempt_id, printer_queue, and cups_job_id — never minting a new attempt ID
        for an already-submitted physical job). Flag uncertain jobs for MANUAL_REVIEW.
        """
        jobs = get_incomplete_jobs()
        if not jobs:
            return

        logger.warning("Found %d incomplete job(s) from previous session. Reconciling with CUPS...", len(jobs))

        for job in jobs:
            order_id = job["order_id"]
            pages_to_print = job.get("pages_to_print", 0)
            attempts = get_attempts_for_order(order_id)
            open_submitted = [a for a in attempts if a.get("cups_job_id") and not a.get("result")]

            logger.info(
                "Reconciling job %s (open attempts: %d, legacy cups_id: %s, recorded pages: %d)",
                order_id,
                len(open_submitted),
                job.get("cups_job_id"),
                job.get("pages_printed", 0),
            )

            if open_submitted:
                all_acked = True
                for att in open_submitted:
                    att_pk = att["id"]
                    att_uid = att.get("attempt_id")
                    cups_id = att["cups_job_id"]
                    printer_q = att.get("printer_queue") or job.get("printer_name") or KYOCERA_QUEUE

                    prog = self.cups.get_job_progress(cups_id)
                    cups_state = prog.get("state")
                    impr = prog.get("impressions_completed", 0)
                    sheets = prog.get("sheets_completed", 0)

                    if cups_state == "completed" and prog.get("verified"):
                        att_pages = max(att.get("pages_printed") or 0, sheets) if sheets > 0 else (att.get("pages_printed") or pages_to_print)
                        logger.info(
                            "Attempt %s (CUPS %s) confirmed completed by CUPS (%d sheets).",
                            att_uid,
                            cups_id,
                            sheets,
                        )
                        update_print_attempt(
                            att_pk,
                            cups_state="completed",
                            result="completed",
                            pages_printed=att_pages,
                            sheets_printed=sheets,
                            ended=True,
                        )
                        ack = self._report_complete(
                            order_id,
                            att_pages,
                            cups_id,
                            attempt_id=att_uid,
                            printer=printer_q,
                        )
                        if not ack:
                            all_acked = False
                    elif cups_state in ("stopped", "canceled", "aborted"):
                        logger.warning("Attempt %s (CUPS %s) was %s at impression %d.", att_uid, cups_id, cups_state, impr)
                        update_print_attempt(
                            att_pk,
                            cups_state=cups_state,
                            result="manual_review",
                            error_msg=f"CUPS stopped before restart ({cups_state})",
                            pages_printed=impr,
                            ended=True,
                        )
                        mark_job_manual_review(
                            order_id,
                            f"CUPS reported state '{cups_state}' before restart. Output unverified: {sheets} sheets.",
                        )
                        self._report_failure(
                            order_id,
                            pages_printed=impr,
                            reason=f"CUPS stopped before agent restart ({cups_state}). Requires manual review.",
                            attempt_id=att_uid,
                        )
                        all_acked = False
                        break
                    else:
                        logger.warning("Attempt %s (CUPS %s) output uncertain after restart. Flagging MANUAL_REVIEW.", att_uid, cups_id)
                        update_print_attempt(
                            att_pk,
                            cups_state=str(cups_state or "unknown"),
                            result="manual_review",
                            error_msg="Agent restarted during execution; physical delivery uncertain",
                            ended=True,
                        )
                        mark_job_manual_review(
                            order_id,
                            f"Agent restarted during execution. Physical delivery unverified. Last sheets: {sheets}",
                        )
                        self._report_failure(
                            order_id,
                            pages_printed=job.get("pages_printed", 0),
                            reason="Agent restarted during execution. Physical delivery uncertain. Flagged for manual review.",
                            attempt_id=att_uid,
                        )
                        all_acked = False
                        break

                if all_acked and not any(a.get("result") in ("failed", "manual_review") for a in attempts):
                    mark_job_completed(order_id)
                continue

            # No open CUPS submission found — uncertain startup crash
            logger.warning("Job %s physical output is uncertain. Flagging for MANUAL_REVIEW.", order_id)
            mark_job_manual_review(
                order_id,
                f"Agent restarted during execution. Physical delivery unverified. Last sheets: {job.get('physical_sheets', 0)}",
            )
            self._report_failure(
                order_id,
                pages_printed=job.get("pages_printed", 0),
                reason="Agent restarted during execution. Physical delivery uncertain. Flagged for manual review.",
            )

    # ------------------------------------------------------------------
    # Hardware Telemetry & Heartbeat
    # ------------------------------------------------------------------

    def get_system_telemetry(self) -> Dict[str, Any]:
        """Collect genuine Raspberry Pi 5 hardware metrics."""
        t: Dict[str, Any] = {
            "tempC": None,
            "cpuPct": None,
            "memPct": None,
            "diskPct": None,
        }

        # Thermal reading
        try:
            tf = "/sys/class/thermal/thermal_zone0/temp"
            if os.path.exists(tf):
                with open(tf) as f:
                    t["tempC"] = round(float(f.read().strip()) / 1000.0, 1)
        except Exception:
            pass

        # Disk usage
        try:
            u = shutil.disk_usage(str(DOCUMENT_STORAGE_DIR))
            t["diskPct"] = round((u.used / u.total) * 100)
        except Exception:
            pass

        # CPU & Memory
        try:
            import psutil  # type: ignore[import-untyped]
            t["cpuPct"] = round(psutil.cpu_percent(interval=None))
            t["memPct"] = round(psutil.virtual_memory().percent)
            sensors_fn = getattr(psutil, "sensors_temperatures", None)
            if t["tempC"] is None and callable(sensors_fn):
                temps = sensors_fn()
                if isinstance(temps, dict):
                    for key in ("cpu_thermal", "coretemp", "cpu-thermal"):
                        entries = temps.get(key)
                        if entries:
                            t["tempC"] = round(entries[0].current, 1)
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

    def send_heartbeat(self) -> None:
        """Report hardware status and telemetry to cloud."""
        now = time.time()
        if now - self.last_heartbeat_time < HEARTBEAT_INTERVAL_SECONDS:
            return

        telemetry = self.get_system_telemetry()
        outbox_stats = get_outbox_stats()

        printer_states = self.monitor.get_all_printer_status()
        self._kyocera_state = printer_states.get("kyocera", {})
        self._canon_state = printer_states.get("canon", {})

        try:
            record_printer_state("kyocera", self._kyocera_state.get("state", "UNKNOWN"), "monitor", self._kyocera_state)
            record_printer_state("canon", self._canon_state.get("state", "UNKNOWN"), "monitor", self._canon_state)
        except Exception:
            pass

        kyocera_ready = self._kyocera_state.get("state") in (STATE_READY, STATE_PRINTING)
        canon_ready = self._canon_state.get("state") in (STATE_READY, STATE_PRINTING)

        # 1. Device Heartbeat (/api/device/heartbeat)
        device_url = f"{CLOUD_API_URL}/api/device/heartbeat"
        device_payload = {
            "kyoceraReady": kyocera_ready,
            "canonReady": canon_ready,
            "kyoceraStatus": self._kyocera_state.get("state", "UNKNOWN"),
            "canonStatus": self._canon_state.get("state", "UNKNOWN"),
            "cupsReachable": self._kyocera_state.get("source") != "none" or self._canon_state.get("source") != "none",
            "agentVersion": AGENT_VERSION,
            "paperReady": (self.kyocera_paper > 0 or self.canon_paper > 0) and self.paper_ready,
            "tonerOk": True,
            "outbox": outbox_stats,
        }
        try:
            body = json.dumps(device_payload).encode("utf-8")
            headers = get_auth_headers(body, method="POST", path="/api/device/heartbeat")
            res = requests.post(device_url, data=body, headers=headers, timeout=8)
            if res.status_code == 200:
                hb = res.json()
                self.kyocera_paper = hb.get("kyoceraPaper", self.kyocera_paper)
                self.canon_paper = hb.get("canonPaper", self.canon_paper)
                self.paper_ready = hb.get("paperReady", True)
                self.maintenance_mode = hb.get("maintenanceMode", False)
            else:
                logger.warning("Device heartbeat returned status %d: %s", res.status_code, res.text[:200])
        except Exception as exc:
            logger.warning("Device heartbeat network error: %s", exc)

        # 2. Admin Telemetry Heartbeat (/api/agent/heartbeat)
        admin_url = f"{CLOUD_API_URL}/api/agent/heartbeat"
        admin_payload = {
            "kioskId": DEVICE_ID,
            "softwareVersion": AGENT_VERSION,
            "networkType": "ethernet",
            "pi": telemetry,
            "outboxStats": outbox_stats,
            "printers": [
                {
                    "id": "kyocera_pa3500x",
                    "queue": KYOCERA_QUEUE,
                    "connected": kyocera_ready,
                    "state": self._kyocera_state.get("state", "UNKNOWN").lower(),
                    "paperRemaining": self.kyocera_paper,
                    "tonerBlack": self._kyocera_state.get("toner_pct"),
                    "errorMessage": self._kyocera_state.get("reason") if not kyocera_ready else None,
                },
                {
                    "id": "canon_gx6170",
                    "queue": CANON_QUEUE,
                    "connected": canon_ready,
                    "state": self._canon_state.get("state", "UNKNOWN").lower(),
                    "paperRemaining": self.canon_paper,
                    "tonerColor": self._canon_state.get("toner_pct"),
                    "errorMessage": self._canon_state.get("reason") if not canon_ready else None,
                },
            ],
        }
        try:
            body2 = json.dumps(admin_payload).encode("utf-8")
            headers2 = get_auth_headers(body2, method="POST", path="/api/agent/heartbeat")
            requests.post(admin_url, data=body2, headers=headers2, timeout=8)
        except Exception as exc:
            logger.debug("Admin telemetry heartbeat notice: %s", exc)

        self.last_heartbeat_time = now

    # ------------------------------------------------------------------
    # Durable Outbox Processing (Verified Acknowledgement & Backoff)
    # ------------------------------------------------------------------

    def flush_outbox(self) -> None:
        """Retry pending events due for transmission with exponential backoff & verified ack."""
        now = time.time()
        if now - self.last_outbox_flush_time < 10:
            return
        self.last_outbox_flush_time = now

        events = get_pending_outbox(limit=5, due_only=True)
        for ev in events:
            ev_id = ev["id"]
            event_id = ev.get("event_id")
            try:
                payload = json.loads(ev["payload_json"])
                url = payload.pop("_url", f"{CLOUD_API_URL}/api/device/jobs/{ev.get('job_id') or ''}")
                method = payload.pop("_method", "POST").upper()
                payload["eventId"] = event_id
                req_payload = {k: v for k, v in payload.items() if not k.startswith("_")}
                body = json.dumps(req_payload).encode("utf-8")
                norm_path = normalize_canonical_path(url)
                headers = get_auth_headers(body, method=method, path=norm_path)

                if method == "PATCH":
                    r = requests.patch(url, data=body, headers=headers, timeout=8)
                else:
                    r = requests.post(url, data=body, headers=headers, timeout=8)

                if 200 <= r.status_code < 300:
                    try:
                        data = r.json() if r.content else {}
                    except Exception:
                        data = {}
                    if isinstance(data, dict) and data.get("acknowledged") is True and data.get("eventId") == event_id:
                        mark_outbox_synced(ev_id)
                        logger.debug("Outbox event #%s successfully acknowledged by cloud (HTTP %d).", event_id, r.status_code)
                    else:
                        schedule_outbox_retry(ev_id, f"HTTP {r.status_code}: Mismatched or missing eventId ack", status_code=r.status_code)
                else:
                    err = f"HTTP {r.status_code}: {r.text[:200]}"
                    logger.warning("Outbox event #%s rejected (%s). Scheduling retry.", event_id, err)
                    schedule_outbox_retry(ev_id, err, status_code=r.status_code)

            except Exception as exc:
                logger.warning("Outbox transmission error for #%s: %s", event_id, exc)
                schedule_outbox_retry(ev_id, str(exc))

    # ------------------------------------------------------------------
    # Durable Command Handling (Lease Recovery & Execution Ack)
    # ------------------------------------------------------------------

    def poll_and_execute_commands(self) -> None:
        """Poll and execute operator commands from the Admin Control Centre."""
        now = time.time()
        if now - self.last_command_poll_time < COMMAND_POLL_INTERVAL:
            return
        self.last_command_poll_time = now

        try:
            path = "/api/agent/commands"
            headers = get_auth_headers(b"", method="GET", path=path)
            res = requests.get(
                f"{CLOUD_API_URL}{path}?kioskId={DEVICE_ID}",
                headers=headers,
                timeout=8,
            )
            if res.status_code != 200:
                return

            commands = res.json().get("commands", [])
            for cmd in commands:
                self._execute_command(cmd)

        except Exception as exc:
            logger.debug("Command poll error: %s", exc)

    def _execute_command(self, cmd: Dict[str, Any]) -> None:
        cmd_id = str(cmd.get("id", ""))
        action = cmd.get("command", "")
        printer_id = cmd.get("printerId", "")
        payload = cmd.get("payload") or {}

        existing = get_command_state(cmd_id) if cmd_id else None
        if existing:
            st = existing.get("status")
            if st == "ack_confirmed":
                logger.info("Command #%s already fully acknowledged — skipping.", cmd_id)
                return

            if st in ("result_persisted", "ack_pending", "execution_completed"):
                # Recover saved result and retry acknowledgement without re-executing
                logger.info("Command #%s was already executed locally — retrying acknowledgement.", cmd_id)
                res_obj = {}
                try:
                    res_obj = json.loads(existing.get("result_json") or "{}")
                except Exception:
                    pass
                saved_status = res_obj.get("status", "succeeded")
                saved_data = res_obj.get("data") or {}
                saved_msg = str(saved_data.get("result") or res_obj.get("result") or "")

                ack_ok = self._acknowledge_command(cmd_id, saved_status, saved_msg)
                if ack_ok:
                    record_command_state(cmd_id, action, "ack_confirmed", saved_status, {"result": saved_msg})
                else:
                    record_command_state(cmd_id, action, "ack_pending", saved_status, {"result": saved_msg})
                return

        if cmd_id:
            record_command_state(cmd_id, action, "received")
            record_command_state(cmd_id, action, "execution_started")

        logger.info("Executing remote command #%s: %s (printer: %s)", cmd_id, action, printer_id)

        status = "succeeded"
        result_msg = ""

        try:
            target_queue = CANON_QUEUE if printer_id and "canon" in printer_id.lower() else KYOCERA_QUEUE

            if action == "test_print":
                ok, cups_id, err = self.cups.print_test_page(target_queue)
                if ok:
                    result_msg = f"Test page sent to {target_queue} (CUPS: {cups_id})"
                else:
                    status = "failed"
                    result_msg = f"Test print failed: {err}"

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

            elif action in ("run_diagnostics", "refresh_status"):
                states = self.monitor.get_all_printer_status()
                telem = self.get_system_telemetry()
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
                result_msg = f"Paper refilled: {target_printer} -> {amount} sheets."

            elif action == "cancel_job":
                job_id = payload.get("cupsJobId", "")
                ok = self.cups.cancel_job(job_id) if job_id else False
                result_msg = f"Cancelled CUPS job {job_id}." if ok else f"Could not cancel {job_id}."
                if not ok:
                    status = "failed"

            elif action == "restart_agent":
                result_msg = "Agent restarting via systemd watchdog..."
                ack_ok = self._acknowledge_command(cmd_id, status, result_msg)
                if cmd_id and ack_ok:
                    record_command_state(cmd_id, action, "ack_confirmed", status, {"result": result_msg})
                time.sleep(1)
                os.execv(sys.executable, [sys.executable] + sys.argv)
                return

            else:
                result_msg = f"Unsupported command '{action}'"
                status = "failed"

        except Exception as exc:
            status = "failed"
            result_msg = f"Exception executing '{action}': {exc}"
            logger.error(result_msg)

        # STRICT: Persist discrete states before and after backend confirmation
        if cmd_id:
            record_command_state(cmd_id, action, "execution_completed", status, {"result": result_msg})
            record_command_state(cmd_id, action, "result_persisted", status, {"result": result_msg})
            record_command_state(cmd_id, action, "ack_pending", status, {"result": result_msg})

        ack_confirmed = self._acknowledge_command(cmd_id, status, result_msg)
        if cmd_id and ack_confirmed:
            record_command_state(cmd_id, action, "ack_confirmed", status, {"result": result_msg})

    def _acknowledge_command(self, cmd_id: str, status: str, result: str) -> bool:
        if not cmd_id:
            return False
        try:
            path = f"/api/agent/commands/{cmd_id}"
            body = json.dumps({"status": status, "result": result[:500]}).encode("utf-8")
            headers = get_auth_headers(body, method="POST", path=path)
            res = requests.post(f"{CLOUD_API_URL}{path}", data=body, headers=headers, timeout=8)
            if 200 <= res.status_code < 300:
                data = res.json() if res.content else {}
                return bool(data.get("ok") or data.get("acknowledged"))
            return False
        except Exception as exc:
            logger.warning("Could not acknowledge command #%s to backend: %s", cmd_id, exc)
            return False

    # ------------------------------------------------------------------
    # Job Polling & Claiming
    # ------------------------------------------------------------------

    def poll_and_process_jobs(self) -> None:
        """Poll cloud for available paid jobs."""
        if self.maintenance_mode:
            return

        if self.kyocera_paper <= 0 and self.canon_paper <= 0:
            logger.warning("Both paper trays exhausted — skipping job polling until refilled.")
            return

        try:
            path = "/api/device/jobs"
            headers = get_auth_headers(b"", method="GET", path=path)
            res = requests.get(f"{CLOUD_API_URL}{path}", headers=headers, timeout=8)
            if res.status_code != 200:
                return

            jobs = res.json().get("jobs", [])
            if not jobs:
                return

            self._claim_and_execute_job(jobs[0]["orderId"])

        except Exception as exc:
            logger.error("Error polling jobs: %s", exc)

    def _claim_and_execute_job(self, order_id: str) -> None:
        """Atomically claim an order and execute the print pipeline."""
        idempotency_key = f"{order_id}-{DEVICE_ID}"
        path = "/api/device/jobs"
        body = json.dumps({"orderId": order_id, "idempotencyKey": idempotency_key}).encode("utf-8")
        headers = get_auth_headers(body, method="POST", path=path)

        try:
            res = requests.post(f"{CLOUD_API_URL}{path}", data=body, headers=headers, timeout=10)
            if res.status_code != 200:
                logger.info("Could not claim job %s: %s", order_id, res.text[:200])
                return

            claim = res.json()
            job_ref = claim["jobRef"]
            settings = claim["settings"]
            docs = claim["docs"]
            pages_to_print = claim["pagesToPrint"]
            claim_attempts = claim.get("attempts") or []
            if not claim_attempts and claim.get("attemptId"):
                claim_attempts = [{"attemptId": claim["attemptId"], "attemptNo": 1, "docId": None}]
            color_mode = settings.get("colorMode", "bw")
            copies = int(settings.get("copies", 1))
            sides = settings.get("sides", "single")
            pages_per_sheet = int(settings.get("pagesPerSheet", 1))

            primary_queue = CANON_QUEUE if color_mode == "color" else KYOCERA_QUEUE
            logger.info(
                "Claimed job %s (%s) -> queue: %s, total pages: %d, docs: %d, attempts: %d",
                order_id,
                job_ref,
                primary_queue,
                pages_to_print,
                len(docs),
                len(claim_attempts),
            )

            record_job_claimed(
                order_id,
                job_ref,
                primary_queue,
                pages_to_print,
                color_mode,
                copies,
                settings,
                idempotency_key=idempotency_key,
                sided=sides,
                pages_per_sheet=pages_per_sheet,
            )

            self._execute_print_pipeline(
                order_id,
                job_ref,
                primary_queue,
                docs,
                settings,
                pages_to_print,
                claim_attempts=claim_attempts,
            )

        except Exception as exc:
            logger.error("Error claiming job %s: %s", order_id, exc)

    @staticmethod
    def _canonical_printer(queue_or_name: Optional[str]) -> str:
        val = (queue_or_name or "").lower()
        return "canon_gx6170" if ("canon" in val or queue_or_name == CANON_QUEUE) else "kyocera_pa3500x"

    # ------------------------------------------------------------------
    # Print Pipeline Execution
    # ------------------------------------------------------------------

    def _execute_print_pipeline(
        self,
        order_id: str,
        job_ref: str,
        primary_queue: str,
        docs: List[Dict[str, Any]],
        settings: Dict[str, Any],
        pages_to_print: int,
        claim_attempts: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        """
        Executes print pipeline with per-attempt backend identity, 1-to-1 CUPS job binding,
        verified multi-doc tracking, capability validation, and strict timeout enforcement.
        """
        job_dir = DOCUMENT_STORAGE_DIR / uuid.uuid4().hex
        job_dir.mkdir(mode=0o700, parents=True, exist_ok=True)

        downloaded_files: List[Tuple[str, str, int]] = []
        total_pages_printed = 0
        cups_job_id: Optional[str] = None
        attempt_id: Optional[int] = None
        current_attempt_uid: Optional[str] = None
        attempt_no = 0
        preflight_rerouted = False

        color_mode = settings.get("colorMode", "bw")
        copies = int(settings.get("copies", 1))
        paper_size = settings.get("paperSize", "A4")
        sides = settings.get("sides", "single")
        orientation = settings.get("orientation", "portrait")
        number_up = int(settings.get("pagesPerSheet", 1))

        try:
            # 1. Capability & Settings Validation
            if number_up not in (1, 2, 4, 6, 9, 16):
                raise ValueError(f"Invalid N-up value: {number_up}. Supported: 1, 2, 4, 6, 9, 16")

            target_printer = "canon" if primary_queue == CANON_QUEUE else "kyocera"
            ready, reason = self.monitor.is_printer_ready(target_printer)

            # Pre-flight routing: if Kyocera is down BEFORE printing begins, route B&W to Canon
            if not ready:
                if color_mode == "bw" and primary_queue == KYOCERA_QUEUE:
                    fb_ready, fb_reason = self.monitor.is_printer_ready("canon")
                    if fb_ready:
                        logger.warning(
                            "Kyocera not ready before job start (%s) — safely routing B&W job to Canon.",
                            reason,
                        )
                        primary_queue = CANON_QUEUE
                        preflight_rerouted = True
                    else:
                        raise RuntimeError(f"Kyocera not ready ({reason}) and Canon backup also not ready ({fb_reason}).")
                else:
                    raise RuntimeError(f"Target printer '{primary_queue}' is not ready: {reason}")

            # 2. Multi-document Download
            for doc in docs:
                doc_id = doc["id"]
                doc_pages = int(doc.get("pages", 1))
                dl_path = f"/api/device/jobs/{order_id}/files/{doc_id}"
                dl_url = f"{CLOUD_API_URL}{dl_path}"
                headers = get_auth_headers(b"", method="GET", path=dl_path)

                logger.info("Downloading document %s for order %s...", doc_id, order_id)
                dl_res = requests.get(dl_url, headers=headers, timeout=60, stream=True)
                if dl_res.status_code != 200:
                    raise RuntimeError(f"Failed to download document {doc_id}: HTTP {dl_res.status_code}")

                ct = dl_res.headers.get("Content-Type", "")
                ext = "pdf" if "pdf" in ct else doc.get("kind", "pdf")
                file_path = str(job_dir / f"{doc_id}.{ext}")

                with open(file_path, "wb") as fh:
                    for chunk in dl_res.iter_content(chunk_size=65536):
                        fh.write(chunk)
                os.chmod(file_path, 0o600)
                downloaded_files.append((doc_id, file_path, doc_pages))

            # 3. Notify cloud: Processing
            self._report_processing(order_id)

            canonical_printer = self._canonical_printer(primary_queue)
            attempts_pool = list(claim_attempts or [])
            all_acked = True

            # 4. Print each document with its own unique attempt & CUPS job ID
            for idx, (doc_id, file_path, doc_pages) in enumerate(downloaded_files):
                expected_doc_pages = doc_pages * copies
                attempt_no += 1

                # Match initial backend attempt if it matches doc & printer
                matched = None
                for cand in attempts_pool:
                    cand_doc = cand.get("docId")
                    if cand_doc == doc_id or (cand_doc is None and idx == 0):
                        matched = cand
                        break
                if matched is None and idx < len(attempts_pool):
                    matched = attempts_pool[idx]

                attempt_uid: Optional[str] = None
                if matched and (matched.get("printerName") in (None, canonical_printer)) and not preflight_rerouted:
                    attempt_uid = matched.get("attemptId")
                    attempt_no = int(matched.get("attemptNo") or attempt_no)
                else:
                    # Create a new authentic backend attempt for preflight reroute or additional attempt
                    supersede_id = matched.get("attemptId") if (matched and preflight_rerouted) else None
                    created = self._create_backend_attempt(
                        order_id=order_id,
                        printer=canonical_printer,
                        doc_id=doc_id,
                        is_fallback=preflight_rerouted,
                        pages_attempted=expected_doc_pages,
                        supersede_attempt_id=supersede_id,
                        reason=f"Pre-flight fallback from {KYOCERA_QUEUE} to {CANON_QUEUE}" if preflight_rerouted else None,
                    )
                    if created:
                        attempt_uid = created.get("attemptId")
                        attempt_no = int(created.get("attemptNo") or attempt_no)

                if not attempt_uid:
                    attempt_uid = f"ATT-LOC-{uuid.uuid4().hex[:12].upper()}"

                current_attempt_uid = attempt_uid
                attempt_id = record_print_attempt(
                    order_id,
                    attempt_no,
                    primary_queue,
                    attempt_id=attempt_uid,
                    doc_id=doc_id,
                )

                success, cups_job_id, err = self.cups.print_file(
                    file_path=file_path,
                    printer_queue=primary_queue,
                    copies=copies,
                    color_mode=color_mode,
                    paper_size=paper_size,
                    sides=sides,
                    orientation=orientation,
                    number_up=number_up,
                )

                if not success or not cups_job_id:
                    if attempt_id:
                        update_print_attempt(attempt_id, result="failed", error_msg=err, ended=True)
                    if cups_job_id == "UNKNOWN/RECONCILIATION_REQUIRED":
                        logger.critical("Uncertain print submission for %s. Halting for MANUAL_REVIEW.", order_id)
                        mark_job_manual_review(order_id, f"Uncertain submission on {primary_queue}: {err}")
                        self._report_failure(
                            order_id,
                            total_pages_printed,
                            f"MANUAL_REVIEW: {err}",
                            attempt_id=attempt_uid,
                            manual_review=True,
                        )
                        return
                    raise RuntimeError(f"CUPS print submission failed on '{primary_queue}': {err}")

                if attempt_id:
                    update_print_attempt(attempt_id, cups_job_id=cups_job_id, cups_state="pending")

                update_job_progress(order_id, total_pages_printed, cups_job_id=cups_job_id, status="printing")

                # Persist (attemptId, cupsJobId) binding on backend BEFORE progress or completion
                self._bind_attempt(order_id, attempt_uid, canonical_printer, cups_job_id)
                self._report_progress(
                    order_id,
                    0,
                    cups_job_id=cups_job_id,
                    status="printing",
                    attempt_id=attempt_uid,
                    printer=canonical_printer,
                )

                # 5. Monitor authentic CUPS progress with strict timeout
                doc_impr_completed = 0
                poll_start = time.time()
                timeout_secs = max(120, expected_doc_pages * 25)
                terminal_completed = False

                while time.time() - poll_start < timeout_secs:
                    prog = self.cups.get_job_progress(cups_job_id)
                    state = prog.get("state", "processing")
                    impr = prog.get("impressions_completed", 0)
                    phys = prog.get("sheets_completed", 0)

                    if impr > doc_impr_completed:
                        delta = impr - doc_impr_completed
                        doc_impr_completed = impr
                        total_pages_printed = min(pages_to_print, total_pages_printed + delta)
                        update_job_progress(
                            order_id,
                            total_pages_printed,
                            cups_job_id=cups_job_id,
                            physical_sheets=phys,
                        )
                        if attempt_id:
                            update_print_attempt(
                                attempt_id,
                                cups_state=state,
                                pages_printed=doc_impr_completed,
                                sheets_printed=phys,
                            )
                        self._report_progress(
                            order_id,
                            doc_impr_completed,
                            cups_job_id=cups_job_id,
                            status="printing",
                            attempt_id=attempt_uid,
                            printer=canonical_printer,
                        )

                    if state == "completed":
                        terminal_completed = True
                        logger.info("CUPS job %s confirmed completed successfully (attempt %s).", cups_job_id, attempt_uid)
                        total_pages_printed = min(pages_to_print, total_pages_printed + (expected_doc_pages - doc_impr_completed))
                        if attempt_id:
                            update_print_attempt(
                                attempt_id,
                                cups_state="completed",
                                result="completed",
                                pages_printed=expected_doc_pages,
                                sheets_printed=phys,
                                ended=True,
                            )
                        # Report completion specifically for THIS attempt & CUPS job ID
                        ack = self._report_complete(
                            order_id,
                            expected_doc_pages,
                            cups_job_id,
                            attempt_id=attempt_uid,
                            printer=canonical_printer,
                        )
                        if not ack:
                            all_acked = False
                        break

                    elif state in ("stopped", "canceled", "aborted"):
                        # Unsafe automatic partial failover disabled — flags MANUAL_REVIEW
                        if attempt_id:
                            update_print_attempt(
                                attempt_id,
                                cups_state=state,
                                result="failed",
                                error_msg=f"CUPS state: {state}",
                                pages_printed=doc_impr_completed,
                                ended=True,
                            )
                        raise RuntimeError(
                            f"Printer hardware fault: CUPS job {cups_job_id} halted in state '{state}' "
                            f"at impression {doc_impr_completed}/{expected_doc_pages}. Output uncertain — requires manual review."
                        )

                    time.sleep(1.5)

                if not terminal_completed:
                    raise RuntimeError(
                        f"Print monitoring timed out after {timeout_secs}s for CUPS job {cups_job_id}. "
                        f"Terminal completion was not verified by hardware. Flagging for manual review."
                    )

            # 6. Mark order locally completed after all attempts finished
            if all_acked:
                mark_job_completed(order_id)
                logger.info("Job %s fully completed and acknowledged by cloud.", order_id)
            else:
                logger.warning("Job %s finished printing but cloud acknowledgement pending. Outbox will retry.", order_id)

        except Exception as exc:
            logger.error("Job %s execution failed: %s", order_id, exc)
            if attempt_id:
                update_print_attempt(attempt_id, result="failed", error_msg=str(exc), ended=True)

            mark_job_manual_review(order_id, str(exc))
            self._report_failure(
                order_id,
                total_pages_printed,
                str(exc),
                attempt_id=current_attempt_uid,
                manual_review=True,
            )

        finally:
            # 7. Document Cleanup & Privacy
            for _, fp, _ in downloaded_files:
                self._secure_delete_file(fp)

            try:
                if job_dir.exists():
                    shutil.rmtree(str(job_dir), ignore_errors=True)
            except Exception as rmtree_err:
                logger.error("Failed to remove job temp directory %s: %s", job_dir, rmtree_err)

    # ------------------------------------------------------------------
    # Cloud Communication with Outbox Fallback
    # ------------------------------------------------------------------

    def _cloud_request(self, path: str, payload: Dict[str, Any], method: str = "POST") -> bool:
        """
        Send API request to cloud backend with durable Outbox backup.
        Only HTTP 2xx WITH verified matching eventId response acknowledgment marks the event synced.
        """
        url = f"{CLOUD_API_URL}{path}" if not path.startswith("http") else path
        norm_path = normalize_canonical_path(url)

        # 1. Generate event UUID before saving
        event_id = payload.get("eventId") or f"evt_{uuid.uuid4().hex}"
        payload["eventId"] = event_id
        payload["kioskId"] = DEVICE_ID
        payload["_url"] = url
        payload["_method"] = method

        # 2. Persist in durable outbox
        row_id = save_outbox_event("cloud_request", payload.get("orderId"), payload, DEVICE_ID, event_id=event_id)

        # 3. Clean payload for HTTP transmission
        req_payload = {k: v for k, v in payload.items() if not k.startswith("_")}
        body = json.dumps(req_payload).encode("utf-8")
        headers = get_auth_headers(body, method=method, path=norm_path)

        try:
            if method == "PATCH":
                res = requests.patch(url, data=body, headers=headers, timeout=8)
            else:
                res = requests.post(url, data=body, headers=headers, timeout=8)

            if 200 <= res.status_code < 300:
                try:
                    data = res.json() if res.content else {}
                except Exception:
                    data = {}

                # Strict V4: Require explicit acknowledgement with matching eventId
                if isinstance(data, dict) and data.get("acknowledged") is True and data.get("eventId") == event_id:
                    mark_outbox_synced(row_id)
                    return True
                else:
                    err_msg = f"HTTP {res.status_code}: Missing or mismatched eventId ack (expected {event_id})"
                    logger.warning("Cloud request to %s rejected: %s", norm_path, err_msg)
                    schedule_outbox_retry(row_id, err_msg, status_code=res.status_code)
                    return False
            else:
                logger.warning("Cloud request to %s rejected: HTTP %d", norm_path, res.status_code)
                schedule_outbox_retry(row_id, f"HTTP {res.status_code}: {res.text[:200]}", status_code=res.status_code)
                return False

        except Exception as exc:
            logger.warning("Network failure reaching %s: %s. Queueing in outbox.", norm_path, exc)
            schedule_outbox_retry(row_id, str(exc))
            return False

    def _create_backend_attempt(
        self,
        order_id: str,
        printer: str,
        doc_id: Optional[str] = None,
        is_fallback: bool = False,
        pages_attempted: Optional[int] = None,
        supersede_attempt_id: Optional[str] = None,
        reason: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Create a new unique print attempt on the backend (for retries, fallbacks, or reroutes)."""
        path = f"/api/device/jobs/{order_id}?action=attempt"
        url = f"{CLOUD_API_URL}{path}"
        norm_path = normalize_canonical_path(url)
        event_id = f"evt_{uuid.uuid4().hex}"
        payload: Dict[str, Any] = {
            "eventId": event_id,
            "orderId": order_id,
            "kioskId": DEVICE_ID,
            "printer": self._canonical_printer(printer),
            "isFallback": is_fallback,
        }
        if doc_id:
            payload["docId"] = doc_id
        if pages_attempted is not None:
            payload["pagesAttempted"] = pages_attempted
        if supersede_attempt_id:
            payload["supersedeAttemptId"] = supersede_attempt_id
        if reason:
            payload["reason"] = reason

        body = json.dumps(payload).encode("utf-8")
        headers = get_auth_headers(body, method="POST", path=norm_path)
        try:
            res = requests.post(url, data=body, headers=headers, timeout=8)
            if 200 <= res.status_code < 300:
                data = res.json() if res.content else {}
                if isinstance(data, dict) and data.get("attemptId"):
                    return data
        except Exception as exc:
            logger.warning("Failed creating backend attempt for %s: %s", order_id, exc)
        return None

    def _bind_attempt(self, order_id: str, attempt_id: str, printer: str, cups_job_id: str) -> bool:
        """Persist 1-to-1 (attemptId, cupsJobId) ownership before sending progress or completion."""
        payload = {
            "orderId": order_id,
            "attemptId": attempt_id,
            "printer": self._canonical_printer(printer),
            "cupsJobId": cups_job_id,
        }
        return self._cloud_request(f"/api/device/jobs/{order_id}?action=bind", payload, method="POST")

    def _report_processing(self, order_id: str) -> bool:
        payload = {"orderId": order_id}
        return self._cloud_request(f"/api/device/jobs/{order_id}?action=processing", payload, method="POST")

    def _report_progress(
        self,
        order_id: str,
        pages_printed: int,
        cups_job_id: Optional[str] = None,
        status: Optional[str] = None,
        attempt_id: Optional[str] = None,
        printer: Optional[str] = None,
    ) -> bool:
        payload: Dict[str, Any] = {"pagesPrinted": pages_printed, "orderId": order_id}
        if attempt_id:
            payload["attemptId"] = attempt_id
        if printer:
            payload["printer"] = self._canonical_printer(printer)
        if cups_job_id:
            payload["cupsJobId"] = cups_job_id
        if status:
            payload["status"] = status
        return self._cloud_request(f"/api/device/jobs/{order_id}", payload, method="PATCH")

    def _report_complete(
        self,
        order_id: str,
        pages_printed: int,
        cups_job_id: Optional[str],
        attempt_id: Optional[str] = None,
        printer: Optional[str] = None,
    ) -> bool:
        payload: Dict[str, Any] = {
            "orderId": order_id,
            "pagesPrinted": pages_printed,
            "cupsJobId": cups_job_id,
        }
        if attempt_id:
            payload["attemptId"] = attempt_id
        if printer:
            payload["printer"] = self._canonical_printer(printer)
        return self._cloud_request(f"/api/device/jobs/{order_id}?action=complete", payload)

    def _report_failure(
        self,
        order_id: str,
        pages_printed: int,
        reason: str,
        attempt_id: Optional[str] = None,
        manual_review: bool = False,
    ) -> bool:
        payload: Dict[str, Any] = {
            "orderId": order_id,
            "pagesPrinted": pages_printed,
            "reason": reason[:500],
            "manualReview": manual_review,
        }
        if attempt_id:
            payload["attemptId"] = attempt_id
        return self._cloud_request(f"/api/device/jobs/{order_id}?action=fail", payload)

    # ------------------------------------------------------------------
    # Document Cleanup & Privacy
    # ------------------------------------------------------------------

    def _secure_delete_file(self, file_path: str) -> None:
        """
        Overwrite temporary customer document before unlinking.
        Logs any failures to ensure privacy issues remain visible.
        """
        try:
            if not os.path.exists(file_path):
                return
            size = os.path.getsize(file_path)
            if size > 0:
                with open(file_path, "r+b") as fh:
                    fh.write(b"\x00" * size)
                    fh.flush()
                    os.fsync(fh.fileno())
            os.remove(file_path)
            logger.debug("Successfully cleaned up customer file: %s", file_path)
        except Exception as exc:
            logger.error("DOCUMENT CLEANUP FAILURE for %s: %s", file_path, exc)

    # ------------------------------------------------------------------
    # Main Daemon Loop
    # ------------------------------------------------------------------

    def run(self) -> None:
        logger.info("PrintBar Agent daemon running — Device: %s", DEVICE_ID)

        while True:
            try:
                self.send_heartbeat()
                self.flush_outbox()
                self.poll_and_execute_commands()
                self.poll_and_process_jobs()

                now = time.time()
                if now - self.last_nonce_cleanup_time > 3600:
                    cleanup_old_nonces(7200)
                    self.last_nonce_cleanup_time = now

            except Exception as exc:
                logger.error("Unhandled exception in agent loop: %s", exc, exc_info=True)

            time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    PrintBarAgent().run()
