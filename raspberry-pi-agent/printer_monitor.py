"""
PrintBar Printer Monitor — Production IPP + CUPS + SNMP status module.

Provides unified printer state classification for Kyocera ECOSYS PA3500x
and Canon MAXIFY GX6170 using:
  1. CUPS local queue readiness (MANDATORY — missing queue is never ready)
  2. IPP attribute query over HTTP/IPP (RFC 8011)
  3. Optional SNMP Printer-MIB (RFC 3805) query
  4. TCP reachability probe (ports 631 and 9100)

States: READY | PRINTING | WARNING | PAPER_OUT | PAPER_JAM |
        COVER_OPEN | OFFLINE | DISABLED | ERROR | UNKNOWN

STRICT RULES:
- A missing or disabled CUPS queue is NEVER ready, even if network IPP responds.
- No fabricated toner or paper percentages. If hardware doesn't report it, state is None / "unsupported".
- Freshness tracking: includes last_successful_check, source, and error details.
"""
import socket
import subprocess
import re
import time
import logging
import struct
import importlib
from typing import Dict, Any, Optional, Tuple

logger = logging.getLogger("printbar.monitor")

STATE_READY      = "READY"
STATE_PRINTING   = "PRINTING"
STATE_WARNING    = "WARNING"
STATE_PAPER_OUT  = "PAPER_OUT"
STATE_PAPER_JAM  = "PAPER_JAM"
STATE_COVER_OPEN = "COVER_OPEN"
STATE_OFFLINE    = "OFFLINE"
STATE_DISABLED   = "DISABLED"
STATE_ERROR      = "ERROR"
STATE_UNKNOWN    = "UNKNOWN"

_IPP_STATE_IDLE       = 3
_IPP_STATE_PROCESSING = 4
_IPP_STATE_STOPPED    = 5

_REASON_MAP = {
    "media-empty":               STATE_PAPER_OUT,
    "media-needed":              STATE_PAPER_OUT,
    "tray-missing":              STATE_PAPER_OUT,
    "media-jam":                 STATE_PAPER_JAM,
    "jammed":                    STATE_PAPER_JAM,
    "door-open":                 STATE_COVER_OPEN,
    "cover-open":                STATE_COVER_OPEN,
    "output-tray-missing":       STATE_COVER_OPEN,
    "offline":                   STATE_OFFLINE,
    "shutdown":                  STATE_OFFLINE,
    "paused":                    STATE_DISABLED,
    "moving-to-paused":          STATE_DISABLED,
    "spool-area-full":           STATE_WARNING,
    "developer-empty":           STATE_WARNING,
    "marker-supply-empty":       STATE_WARNING,
    "toner-empty":               STATE_WARNING,
    "ink-empty":                 STATE_WARNING,
    "output-area-full":          STATE_WARNING,
}


class PrinterMonitor:
    """Unified printer status checker for the PrintBar printers."""

    def __init__(
        self,
        kyocera_ip: str = "",
        canon_ip: str = "",
        kyocera_queue: str = "printbar-kyocera",
        canon_queue: str = "printbar-canon",
    ):
        self.kyocera_ip    = kyocera_ip
        self.canon_ip      = canon_ip
        self.kyocera_queue = kyocera_queue
        self.canon_queue   = canon_queue

        self.last_check_times: Dict[str, float] = {}
        self.last_successful_times: Dict[str, float] = {}

    def get_all_printer_status(self) -> Dict[str, Dict[str, Any]]:
        return {
            "kyocera": self.get_unified_status("kyocera", self.kyocera_ip, self.kyocera_queue),
            "canon":   self.get_unified_status("canon",   self.canon_ip,   self.canon_queue),
        }

    get_all_printers_status = get_all_printer_status

    def get_unified_status(self, printer_id: str, ip: str, queue: str) -> Dict[str, Any]:
        """
        Determine printer state using CUPS + Network IPP + SNMP in priority order.
        Strict: If local CUPS queue is missing or disabled, the printer cannot print,
        so it is NEVER marked READY regardless of IPP responses.
        """
        now = time.time()
        self.last_check_times[printer_id] = now

        result: Dict[str, Any] = {
            "printer_id":  printer_id,
            "queue":       queue,
            "ip":          ip,
            "state":       STATE_UNKNOWN,
            "reason":      "",
            "source":      "none",
            "reachable":   False,
            "cups_state":  None,
            "ipp_state":   None,
            "snmp_status": "unsupported",
            "toner_pct":   None,  # Honest: None = unsupported/unreported
            "markers":     {},
            "last_checked_at": time.strftime("%Y-%m-%d %H:%M:%S IST", time.localtime(now)),
            "last_successful_at": None,
        }

        # 1. CUPS queue check (primary requirement for printing)
        cups_info = self._check_cups_queue(queue)
        result["cups_state"] = cups_info.get("state")

        if cups_info.get("state") is None or cups_info.get("state") == "missing":
            result.update(
                state=STATE_ERROR,
                source="cups",
                reachable=False,
                reason=cups_info.get("reason") or f"CUPS queue '{queue}' does not exist on this system.",
            )
            return result

        if cups_info.get("state") == "disabled":
            result.update(
                state=STATE_DISABLED,
                source="cups",
                reachable=True,
                reason=cups_info.get("reason", "Queue is disabled in CUPS."),
            )
            return result

        # 2. Network reachability
        if ip:
            reachable_ipp = self._check_tcp(ip, 631)
            reachable_raw = self._check_tcp(ip, 9100)
            result["reachable"] = reachable_ipp or reachable_raw
        else:
            result["reachable"] = cups_info.get("state") not in (None, "unknown", "missing")

        if not result["reachable"] and ip:
            result.update(
                state=STATE_OFFLINE,
                source="tcp",
                reason=f"Printer at {ip} not reachable on ports 631 or 9100.",
            )
            return result

        # 3. IPP attribute query (if IP configured and reachable)
        if ip and result["reachable"]:
            ipp_info = self._check_ipp_status(ip)
            if ipp_info.get("success"):
                result["ipp_state"] = ipp_info.get("printer_state")
                result["markers"] = ipp_info.get("markers", {})
                if "toner" in result["markers"]:
                    result["toner_pct"] = result["markers"]["toner"]

                derived = self._classify_ipp(ipp_info)
                if derived in (STATE_PAPER_OUT, STATE_PAPER_JAM, STATE_COVER_OPEN, STATE_WARNING):
                    result.update(
                        state=derived,
                        source="ipp",
                        reason=ipp_info.get("printer_state_reasons", ""),
                    )
                    self.last_successful_times[printer_id] = now
                    result["last_successful_at"] = time.strftime("%Y-%m-%d %H:%M:%S IST", time.localtime(now))
                    return result
                elif derived in (STATE_READY, STATE_PRINTING) and cups_info.get("state") in ("idle", "processing"):
                    result.update(
                        state=derived,
                        source="ipp+cups",
                        reason=ipp_info.get("printer_state_reasons", ""),
                    )
                    self.last_successful_times[printer_id] = now
                    result["last_successful_at"] = time.strftime("%Y-%m-%d %H:%M:%S IST", time.localtime(now))
                    return result

        # 4. SNMP query (optional read-only check on LAN)
        if ip and result["reachable"]:
            snmp_info = self._check_snmp(ip)
            if snmp_info.get("supported"):
                result["snmp_status"] = "active"
                if snmp_info.get("toner_pct") is not None:
                    result["toner_pct"] = snmp_info.get("toner_pct")

        # 5. Fall back to CUPS state interpretation
        if cups_info.get("state") == "idle":
            result.update(state=STATE_READY, source="cups", reason="")
            self.last_successful_times[printer_id] = now
            result["last_successful_at"] = time.strftime("%Y-%m-%d %H:%M:%S IST", time.localtime(now))
        elif cups_info.get("state") == "processing":
            result.update(state=STATE_PRINTING, source="cups", reason="")
            self.last_successful_times[printer_id] = now
            result["last_successful_at"] = time.strftime("%Y-%m-%d %H:%M:%S IST", time.localtime(now))
        else:
            result.update(
                state=STATE_UNKNOWN,
                source="cups",
                reason=cups_info.get("reason", "CUPS queue state unknown"),
            )

        last_succ = self.last_successful_times.get(printer_id)
        result["is_stale"] = bool(last_succ and (now - last_succ > 120))
        result["last_attempted_at"] = time.strftime("%Y-%m-%d %H:%M:%S IST", time.localtime(now))

        return result

    # ------------------------------------------------------------------
    # CUPS queue inspection
    # ------------------------------------------------------------------

    def _check_cups_queue(self, queue: str) -> Dict[str, Any]:
        info: Dict[str, Any] = {"state": None, "reason": ""}

        try:
            cups = importlib.import_module("cups")
            conn = cups.Connection()
            printers = conn.getPrinters()
            if queue in printers:
                p = printers[queue]
                state_code = p.get("printer-state", 0)
                state_map = {3: "idle", 4: "processing", 5: "stopped"}
                info["state"] = state_map.get(state_code, "unknown")
                info["reason"] = p.get("printer-state-reasons", "")
                return info
            else:
                info["state"] = "missing"
                return info
        except Exception:
            pass

        try:
            res = subprocess.run(
                ["lpstat", "-p", queue],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if res.returncode == 0:
                out = res.stdout.lower()
                if "is idle" in out:
                    info["state"] = "idle"
                elif "is printing" in out:
                    info["state"] = "processing"
                elif "is disabled" in out or "disabled since" in out:
                    info["state"] = "disabled"
                    m = re.search(r"disabled since.*?-\s*(.*)", res.stdout, re.IGNORECASE)
                    if m:
                        info["reason"] = m.group(1).strip()
                else:
                    info["state"] = "unknown"
            else:
                info["state"] = "missing"
        except FileNotFoundError:
            info["state"] = None
            info["reason"] = "CUPS client binary (lpstat) not installed on host"
        except Exception as exc:
            info["state"] = "unknown"
            info["reason"] = str(exc)

        return info

    # ------------------------------------------------------------------
    # TCP reachability
    # ------------------------------------------------------------------

    def _check_tcp(self, ip: str, port: int, timeout: float = 3.0) -> bool:
        if not ip:
            return False
        try:
            with socket.create_connection((ip, port), timeout=timeout):
                return True
        except (OSError, socket.timeout):
            return False

    # ------------------------------------------------------------------
    # IPP (RFC 8011) Query & Parsing
    # ------------------------------------------------------------------

    def _check_ipp_status(self, ip: str, port: int = 631) -> Dict[str, Any]:
        result: Dict[str, Any] = {"success": False, "markers": {}}
        if not ip:
            return result
        try:
            ipp_request = self._build_ipp_get_printer_attrs(ip, port)
            with socket.create_connection((ip, port), timeout=4) as s:
                http_req = (
                    f"POST /ipp/print HTTP/1.1\r\n"
                    f"Host: {ip}:{port}\r\n"
                    f"Content-Type: application/ipp\r\n"
                    f"Content-Length: {len(ipp_request)}\r\n"
                    f"Connection: close\r\n\r\n"
                ).encode() + ipp_request
                s.sendall(http_req)

                raw = b""
                while True:
                    chunk = s.recv(4096)
                    if not chunk:
                        break
                    raw += chunk

            if b"\r\n\r\n" in raw:
                ipp_body = raw.split(b"\r\n\r\n", 1)[1]
            else:
                ipp_body = raw

            parsed = self._parse_ipp_response(ipp_body)
            result.update(parsed)
            result["success"] = True
        except Exception as exc:
            logger.debug("IPP query to %s:%d failed: %s", ip, port, exc)
        return result

    def _build_ipp_get_printer_attrs(self, ip: str, port: int) -> bytes:
        header = struct.pack(">HHI", 0x0101, 0x000B, 1)

        def tag_val(tag: int, name: bytes, value: bytes) -> bytes:
            return struct.pack(">BHH", tag, len(name), len(value)) + name + value

        attrs = b"\x01"
        attrs += tag_val(0x47, b"attributes-charset", b"utf-8")
        attrs += tag_val(0x48, b"attributes-natural-language", b"en")
        uri = f"ipp://{ip}:{port}/ipp/print".encode()
        attrs += tag_val(0x45, b"printer-uri", uri)

        for a in (
            b"printer-state",
            b"printer-state-reasons",
            b"printer-state-message",
            b"marker-levels",
            b"marker-names",
        ):
            attrs += tag_val(0x44, b"requested-attributes", a)

        attrs += b"\x03"
        return header + attrs

    def _parse_ipp_response(self, body: bytes) -> Dict[str, Any]:
        result: Dict[str, Any] = {
            "printer_state": None,
            "printer_state_reasons": "",
            "printer_state_message": "",
            "markers": {},
        }
        try:
            if len(body) < 8:
                return result
            pos = 8
            reasons = []
            while pos < len(body):
                tag = body[pos]
                pos += 1
                if tag <= 0x0F:
                    if tag == 0x03:
                        break
                    continue
                if pos + 2 > len(body):
                    break
                name_len = struct.unpack(">H", body[pos : pos + 2])[0]
                pos += 2
                name = body[pos : pos + name_len].decode("utf-8", errors="replace")
                pos += name_len
                if pos + 2 > len(body):
                    break
                val_len = struct.unpack(">H", body[pos : pos + val_len])[0]
                pos += 2
                value = body[pos : pos + val_len]
                pos += val_len

                if name == "printer-state" and len(value) == 4:
                    result["printer_state"] = struct.unpack(">I", value)[0]
                elif name == "printer-state-reasons":
                    reasons.append(value.decode("utf-8", errors="replace"))
                elif name == "printer-state-message":
                    result["printer_state_message"] = value.decode("utf-8", errors="replace")

            result["printer_state_reasons"] = ", ".join(reasons)
        except Exception as exc:
            logger.debug("IPP parse error: %s", exc)
        return result

    def _classify_ipp(self, ipp_info: Dict[str, Any]) -> str:
        state_code = ipp_info.get("printer_state")
        reasons_str = ipp_info.get("printer_state_reasons", "").lower()

        for keyword, mapped_state in _REASON_MAP.items():
            if keyword in reasons_str:
                return mapped_state

        if state_code == _IPP_STATE_IDLE:
            return STATE_READY
        if state_code == _IPP_STATE_PROCESSING:
            return STATE_PRINTING
        if state_code == _IPP_STATE_STOPPED:
            return STATE_ERROR

        return STATE_UNKNOWN

    # ------------------------------------------------------------------
    # SNMP Monitoring (Read-only query on LAN where supported)
    # ------------------------------------------------------------------

    def _check_snmp(self, ip: str, community: str = "public") -> Dict[str, Any]:
        """
        Check printer via SNMP Printer-MIB (RFC 3805) if snmpget CLI is available.
        Never fabricates values if unavailable.
        """
        info: Dict[str, Any] = {"supported": False, "toner_pct": None}
        try:
            # Query standard Printer-MIB hrDeviceStatus (1.3.6.1.2.1.25.3.2.1.5.1)
            res = subprocess.run(
                ["snmpget", "-v2c", "-c", community, "-t", "2", "-r", "1", ip, "1.3.6.1.2.1.25.3.2.1.5.1"],
                capture_output=True,
                text=True,
                timeout=3,
            )
            if res.returncode == 0:
                info["supported"] = True
                # Query marker supply level (1.3.6.1.2.1.43.11.1.1.9.1.1) and max (1.3.6.1.2.1.43.11.1.1.8.1.1)
                res_lvl = subprocess.run(
                    ["snmpget", "-v2c", "-c", community, "-t", "2", ip, "1.3.6.1.2.1.43.11.1.1.9.1.1", "1.3.6.1.2.1.43.11.1.1.8.1.1"],
                    capture_output=True,
                    text=True,
                    timeout=3,
                )
                if res_lvl.returncode == 0:
                    nums = [int(s) for s in re.findall(r"INTEGER:\s*(-?\d+)", res_lvl.stdout)]
                    if len(nums) >= 2 and nums[1] > 0 and nums[0] >= 0:
                        info["toner_pct"] = max(0, min(100, round((nums[0] / nums[1]) * 100)))
        except (FileNotFoundError, subprocess.TimeoutExpired, Exception):
            pass
        return info

    def is_printer_ready(self, printer_id: str) -> Tuple[bool, str]:
        """
        Returns (ready: bool, reason: str).
        A printer is ready ONLY IF its local CUPS queue is present, active,
        and its state is READY or PRINTING.
        """
        ip = self.kyocera_ip if printer_id == "kyocera" else self.canon_ip
        queue = self.kyocera_queue if printer_id == "kyocera" else self.canon_queue
        status = self.get_unified_status(printer_id, ip, queue)
        state = status.get("state", STATE_UNKNOWN)
        ready = state in (STATE_READY, STATE_PRINTING) and status.get("cups_state") in ("idle", "processing")
        return ready, status.get("reason", state)
