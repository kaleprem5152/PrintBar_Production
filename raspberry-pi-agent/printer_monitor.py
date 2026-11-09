"""
PrintBar Printer Monitor — Production IPP + CUPS status module.

Provides unified printer state classification for Kyocera ECOSYS PA3500x
and Canon MAXIFY GX6170 using:
  1. CUPS lpstat / PyCUPS (primary)
  2. IPP attribute query over HTTP (secondary)
  3. TCP reachability probe (tertiary)

States: READY | PRINTING | WARNING | PAPER_OUT | PAPER_JAM |
        COVER_OPEN | OFFLINE | DISABLED | ERROR | UNKNOWN
"""
import socket
import subprocess
import re
import logging
import struct
import importlib
from typing import Dict, Any, Optional, Tuple

logger = logging.getLogger("printbar.monitor")

# ---------------------------------------------------------------------------
# State constants
# ---------------------------------------------------------------------------
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

# IPP state codes (RFC 8011)
_IPP_STATE_IDLE       = 3
_IPP_STATE_PROCESSING = 4
_IPP_STATE_STOPPED    = 5

# IPP state-reasons that map to specific states
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
    """Unified printer status checker for the two PrintBar printers."""

    def __init__(self, kyocera_ip: str = "", canon_ip: str = "",
                 kyocera_queue: str = "printbar-kyocera",
                 canon_queue: str = "printbar-canon"):
        self.kyocera_ip    = kyocera_ip
        self.canon_ip      = canon_ip
        self.kyocera_queue = kyocera_queue
        self.canon_queue   = canon_queue

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_all_printer_status(self) -> Dict[str, Dict[str, Any]]:
        """Return status for both printers keyed by printer ID."""
        return {
            "kyocera": self.get_unified_status("kyocera", self.kyocera_ip, self.kyocera_queue),
            "canon":   self.get_unified_status("canon",   self.canon_ip,   self.canon_queue),
        }

    def get_unified_status(self, printer_id: str, ip: str, queue: str) -> Dict[str, Any]:
        """
        Determine printer state using multiple sources in priority order.
        Returns a dict suitable for the heartbeat payload and admin dashboard.
        """
        result: Dict[str, Any] = {
            "printer_id": printer_id,
            "queue":      queue,
            "ip":         ip,
            "state":      STATE_UNKNOWN,
            "reason":     "",
            "source":     "none",
            "reachable":  False,
            "ipp_state":  None,
            "cups_state": None,
        }

        # 1. CUPS via lpstat (most authoritative on-Pi source)
        cups_info = self._check_cups_queue(queue)
        result["cups_state"] = cups_info.get("state")
        if cups_info.get("state") == "disabled":
            result.update(state=STATE_DISABLED, source="cups", reachable=True,
                          reason=cups_info.get("reason", ""))
            return result

        # 2. Network reachability
        if ip:
            reachable_ipp  = self._check_tcp(ip, 631)
            reachable_raw  = self._check_tcp(ip, 9100)
            result["reachable"] = reachable_ipp or reachable_raw
        else:
            # No IP configured — rely on CUPS only
            result["reachable"] = cups_info.get("state") not in (None, "unknown")

        if not result["reachable"] and ip:
            result.update(state=STATE_OFFLINE, source="tcp", reason="Printer not reachable on network")
            return result

        # 3. IPP attribute query (if IP known)
        if ip:
            ipp_info = self._check_ipp_status(ip)
            if ipp_info.get("success"):
                result["ipp_state"] = ipp_info.get("printer_state")
                derived = self._classify_ipp(ipp_info)
                if derived != STATE_UNKNOWN:
                    result.update(state=derived, source="ipp",
                                  reason=ipp_info.get("printer_state_reasons", ""))
                    return result

        # 4. Fall back to CUPS state interpretation
        if cups_info.get("state") == "idle":
            result.update(state=STATE_READY, source="cups", reason="")
        elif cups_info.get("state") == "processing":
            result.update(state=STATE_PRINTING, source="cups", reason="")
        elif cups_info.get("state") is not None:
            result.update(state=STATE_UNKNOWN, source="cups",
                          reason=cups_info.get("state", ""))

        return result

    # ------------------------------------------------------------------
    # CUPS
    # ------------------------------------------------------------------

    def _check_cups_queue(self, queue: str) -> Dict[str, Any]:
        info: Dict[str, Any] = {"state": None, "reason": ""}

        # Try PyCUPS first
        try:
            cups = importlib.import_module("cups")
            conn = cups.Connection()
            printers = conn.getPrinters()
            if queue in printers:
                p = printers[queue]
                state_code = p.get("printer-state", 0)
                state_map = {3: "idle", 4: "printing", 5: "stopped"}
                info["state"] = state_map.get(state_code, "unknown")
                info["reason"] = p.get("printer-state-reasons", "")
                return info
        except Exception:
            pass

        # Fallback: lpstat
        try:
            res = subprocess.run(
                ["lpstat", "-p", queue],
                capture_output=True, text=True, timeout=5
            )
            if res.returncode == 0:
                out = res.stdout.lower()
                if "is idle" in out:
                    info["state"] = "idle"
                elif "is printing" in out:
                    info["state"] = "processing"
                elif "is disabled" in out or "disabled since" in out:
                    info["state"] = "disabled"
                    # Extract reason
                    m = re.search(r"disabled since.*?-\s*(.*)", res.stdout, re.IGNORECASE)
                    if m:
                        info["reason"] = m.group(1).strip()
                else:
                    info["state"] = "unknown"
            else:
                # Queue may not exist
                info["state"] = None
        except FileNotFoundError:
            # lpstat not available (dev environment)
            logger.debug("lpstat not found — running outside Pi environment")
        except Exception as exc:
            logger.debug("lpstat error for %s: %s", queue, exc)

        return info

    # ------------------------------------------------------------------
    # TCP reachability
    # ------------------------------------------------------------------

    def _check_tcp(self, ip: str, port: int, timeout: float = 3.0) -> bool:
        try:
            with socket.create_connection((ip, port), timeout=timeout):
                return True
        except (OSError, socket.timeout):
            return False

    # ------------------------------------------------------------------
    # IPP
    # ------------------------------------------------------------------

    def _check_ipp_status(self, ip: str, port: int = 631) -> Dict[str, Any]:
        """
        Send a minimal IPP Get-Printer-Attributes request and parse the response.
        Uses raw sockets so we have no dependency on python-ipp or pycups.
        """
        result: Dict[str, Any] = {"success": False}
        try:
            ipp_request = self._build_ipp_get_printer_attrs(ip, port)
            with socket.create_connection((ip, port), timeout=5) as s:
                # Wrap in HTTP POST
                http_req = (
                    f"POST /ipp/print HTTP/1.1\r\n"
                    f"Host: {ip}:{port}\r\n"
                    f"Content-Type: application/ipp\r\n"
                    f"Content-Length: {len(ipp_request)}\r\n"
                    f"Connection: close\r\n\r\n"
                ).encode() + ipp_request
                s.sendall(http_req)

                # Read response
                raw = b""
                while True:
                    chunk = s.recv(4096)
                    if not chunk:
                        break
                    raw += chunk

            # Strip HTTP headers
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
        """
        Build a minimal IPP/1.1 Get-Printer-Attributes request (RFC 8011 §4.2.5).
        Requests: printer-state, printer-state-reasons, printer-state-message
        """
        # IPP header: version(2), op(2), request-id(4)
        header = struct.pack(">HHI", 0x0101, 0x000B, 1)

        def tag_value(tag: int, name: bytes, value: bytes) -> bytes:
            return struct.pack(">BHH", tag, len(name), len(value)) + name + value

        # Operation attributes group tag (0x01)
        attrs = b"\x01"
        # attributes-charset (0x47)
        attrs += tag_value(0x47, b"attributes-charset", b"utf-8")
        # attributes-natural-language (0x48)
        attrs += tag_value(0x48, b"attributes-natural-language", b"en")
        # printer-uri (0x45)
        uri = f"ipp://{ip}:{port}/ipp/print".encode()
        attrs += tag_value(0x45, b"printer-uri", uri)

        # Requested attributes (0x44 = keyword)
        for attr in (b"printer-state", b"printer-state-reasons", b"printer-state-message"):
            attrs += tag_value(0x44, b"requested-attributes", attr)

        # End-of-attributes tag (0x03)
        attrs += b"\x03"
        return header + attrs

    def _parse_ipp_response(self, body: bytes) -> Dict[str, Any]:
        """
        Minimal IPP response parser — extracts printer-state and printer-state-reasons.
        """
        result: Dict[str, Any] = {
            "printer_state": None,
            "printer_state_reasons": "",
            "printer_state_message": "",
        }
        try:
            if len(body) < 8:
                return result
            # Skip version(2) + status(2) + request-id(4) = 8 bytes
            pos = 8
            # Skip group tags and read attribute triplets
            reasons: list = []
            while pos < len(body):
                tag = body[pos]; pos += 1
                if tag <= 0x0F:
                    # Delimiter tag — skip
                    if tag == 0x03:
                        break
                    continue
                # Read name length + name
                if pos + 2 > len(body):
                    break
                name_len = struct.unpack(">H", body[pos:pos+2])[0]; pos += 2
                name = body[pos:pos+name_len].decode("utf-8", errors="replace"); pos += name_len
                # Read value length + value
                if pos + 2 > len(body):
                    break
                val_len = struct.unpack(">H", body[pos:pos+2])[0]; pos += 2
                value = body[pos:pos+val_len]; pos += val_len

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
        """Map IPP attributes to a PrintBar state constant."""
        state_code = ipp_info.get("printer_state")
        reasons_str = ipp_info.get("printer_state_reasons", "").lower()

        # Check reasons first (more specific)
        for keyword, mapped_state in _REASON_MAP.items():
            if keyword in reasons_str:
                return mapped_state

        # Fall back to state code
        if state_code == _IPP_STATE_IDLE:
            return STATE_READY
        if state_code == _IPP_STATE_PROCESSING:
            return STATE_PRINTING
        if state_code == _IPP_STATE_STOPPED:
            return STATE_ERROR

        return STATE_UNKNOWN

    # ------------------------------------------------------------------
    # Convenience helpers
    # ------------------------------------------------------------------

    def is_printer_ready(self, printer_id: str) -> Tuple[bool, str]:
        """
        Returns (ready: bool, reason: str).
        Only READY and PRINTING are considered operational.
        """
        ip    = self.kyocera_ip    if printer_id == "kyocera" else self.canon_ip
        queue = self.kyocera_queue if printer_id == "kyocera" else self.canon_queue
        status = self.get_unified_status(printer_id, ip, queue)
        state = status.get("state", STATE_UNKNOWN)
        ready = state in (STATE_READY, STATE_PRINTING)
        return ready, status.get("reason", state)

