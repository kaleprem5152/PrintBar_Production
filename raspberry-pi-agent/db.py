"""
Local SQLite database for the PrintBar Raspberry Pi Agent.

Production-grade features:
- WAL journal mode for concurrent reads
- Foreign key enforcement
- 5-second busy timeout
- Schema versioning with safe migrations
- Outbox pattern for durable cloud event delivery
- Print attempt history
- Durable nonce storage for HMAC replay protection
- Printer state history
- Command execution history
"""
import sqlite3
import json
import logging
from datetime import datetime
from typing import Optional, Dict, Any, List
from config import SQLITE_DB_PATH

logger = logging.getLogger("printbar.db")

# Current schema version — bump when adding tables/columns
SCHEMA_VERSION = 3


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(SQLITE_DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def _get_schema_version(conn: sqlite3.Connection) -> int:
    try:
        row = conn.execute("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1").fetchone()
        return row["version"] if row else 0
    except Exception:
        return 0


def _set_schema_version(conn: sqlite3.Connection, version: int) -> None:
    conn.execute("INSERT INTO schema_version (version, applied_at) VALUES (?, CURRENT_TIMESTAMP)", (version,))


def init_db() -> None:
    """Initialize all tables with schema versioning and safe migrations."""
    with get_connection() as conn:
        # --- Schema version tracking ---
        conn.execute("""
            CREATE TABLE IF NOT EXISTS schema_version (
                version    INTEGER PRIMARY KEY,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        current = _get_schema_version(conn)

        if current < 1:
            logger.info("Applying schema migration v1: core tables")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS local_jobs (
                    order_id          TEXT PRIMARY KEY,
                    job_ref           TEXT,
                    idempotency_key   TEXT UNIQUE,
                    printer_name      TEXT,
                    fallback_printer  TEXT,
                    cups_job_id       TEXT,
                    status            TEXT NOT NULL DEFAULT 'claimed',
                    recovery_state    TEXT,
                    pages_to_print    INTEGER,
                    pages_printed     INTEGER DEFAULT 0,
                    physical_sheets   INTEGER DEFAULT 0,
                    color_mode        TEXT,
                    copies            INTEGER DEFAULT 1,
                    pages_per_sheet   INTEGER DEFAULT 1,
                    sided             TEXT DEFAULT 'single',
                    page_range        TEXT,
                    settings_json     TEXT,
                    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS print_attempts (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    order_id        TEXT NOT NULL,
                    attempt_no      INTEGER NOT NULL DEFAULT 1,
                    printer_queue   TEXT,
                    cups_job_id     TEXT,
                    cups_state      TEXT,
                    pages_printed   INTEGER DEFAULT 0,
                    sheets_printed  INTEGER DEFAULT 0,
                    started_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    ended_at        TIMESTAMP,
                    result          TEXT,
                    error_msg       TEXT,
                    FOREIGN KEY (order_id) REFERENCES local_jobs(order_id)
                )
            """)
            _set_schema_version(conn, 1)

        if current < 2:
            logger.info("Applying schema migration v2: outbox, nonces, command history")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS outbox_events (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type   TEXT NOT NULL,
                    job_id       TEXT,
                    payload_json TEXT NOT NULL,
                    synced       INTEGER NOT NULL DEFAULT 0,
                    retry_count  INTEGER NOT NULL DEFAULT 0,
                    last_error   TEXT,
                    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    synced_at    TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS nonces (
                    nonce      TEXT PRIMARY KEY,
                    device_id  TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS command_history (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    command_id   TEXT UNIQUE,
                    command      TEXT NOT NULL,
                    received_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    executed_at  TIMESTAMP,
                    status       TEXT DEFAULT 'pending',
                    result_json  TEXT
                )
            """)
            _set_schema_version(conn, 2)

        if current < 3:
            logger.info("Applying schema migration v3: printer state history")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS printer_state_history (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    printer_id  TEXT NOT NULL,
                    state       TEXT NOT NULL,
                    source      TEXT,
                    raw_data    TEXT,
                    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            _set_schema_version(conn, 3)

        conn.commit()
    logger.info("Database initialized at schema version %d", SCHEMA_VERSION)


# ---------------------------------------------------------------------------
# Job operations
# ---------------------------------------------------------------------------

def record_job_claimed(
    order_id: str,
    job_ref: str,
    printer_name: str,
    pages_to_print: int,
    color_mode: str,
    copies: int,
    settings: Dict[str, Any],
    idempotency_key: Optional[str] = None,
    sided: str = "single",
    pages_per_sheet: int = 1,
) -> None:
    key = idempotency_key or order_id
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO local_jobs (
                order_id, job_ref, idempotency_key, printer_name, status,
                pages_to_print, pages_printed, color_mode, copies,
                pages_per_sheet, sided, settings_json, updated_at
            ) VALUES (?, ?, ?, ?, 'claimed', ?, 0, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(order_id) DO UPDATE SET
                status='claimed', updated_at=CURRENT_TIMESTAMP
        """, (order_id, job_ref, key, printer_name, pages_to_print,
              color_mode, copies, pages_per_sheet, sided, json.dumps(settings)))
        conn.commit()


def update_job_progress(
    order_id: str,
    pages_printed: int,
    cups_job_id: Optional[str] = None,
    status: Optional[str] = None,
    physical_sheets: Optional[int] = None,
    page_range: Optional[str] = None,
) -> None:
    with get_connection() as conn:
        query = "UPDATE local_jobs SET pages_printed = ?, updated_at = CURRENT_TIMESTAMP"
        params: list = [pages_printed]
        if cups_job_id is not None:
            query += ", cups_job_id = ?"
            params.append(cups_job_id)
        if status is not None:
            query += ", status = ?"
            params.append(status)
        if physical_sheets is not None:
            query += ", physical_sheets = ?"
            params.append(physical_sheets)
        if page_range is not None:
            query += ", page_range = ?"
            params.append(page_range)
        query += " WHERE order_id = ?"
        params.append(order_id)
        conn.execute(query, params)
        conn.commit()


def mark_job_completed(order_id: str) -> None:
    with get_connection() as conn:
        conn.execute(
            "UPDATE local_jobs SET status='completed', updated_at=CURRENT_TIMESTAMP WHERE order_id=?",
            (order_id,)
        )
        conn.commit()


def mark_job_failed(order_id: str, error: Optional[str] = None) -> None:
    with get_connection() as conn:
        conn.execute(
            "UPDATE local_jobs SET status='failed', recovery_state=?, updated_at=CURRENT_TIMESTAMP WHERE order_id=?",
            (error, order_id)
        )
        conn.commit()


def get_active_job() -> Optional[Dict[str, Any]]:
    with get_connection() as conn:
        row = conn.execute(
            """SELECT * FROM local_jobs
               WHERE status IN ('claimed','processing','printing','fallback_pending','fallback_printing')
               ORDER BY updated_at DESC LIMIT 1"""
        ).fetchone()
        return dict(row) if row else None


def get_incomplete_jobs() -> List[Dict[str, Any]]:
    """Return all jobs that were not completed — used for startup recovery."""
    with get_connection() as conn:
        rows = conn.execute(
            """SELECT * FROM local_jobs
               WHERE status NOT IN ('completed','failed','canceled')
               ORDER BY created_at ASC"""
        ).fetchall()
        return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Print attempt tracking
# ---------------------------------------------------------------------------

def record_print_attempt(
    order_id: str,
    attempt_no: int,
    printer_queue: str,
    cups_job_id: Optional[str] = None,
) -> int:
    """Insert a new attempt row and return its rowid."""
    with get_connection() as conn:
        cur = conn.execute("""
            INSERT INTO print_attempts (order_id, attempt_no, printer_queue, cups_job_id, cups_state)
            VALUES (?, ?, ?, ?, 'pending')
        """, (order_id, attempt_no, printer_queue, cups_job_id))
        conn.commit()
        return cur.lastrowid or 0


def update_print_attempt(
    attempt_id: int,
    cups_state: Optional[str] = None,
    pages_printed: Optional[int] = None,
    sheets_printed: Optional[int] = None,
    result: Optional[str] = None,
    error_msg: Optional[str] = None,
    ended: bool = False,
) -> None:
    with get_connection() as conn:
        query = "UPDATE print_attempts SET "
        parts: list = []
        params: list = []
        if cups_state is not None:
            parts.append("cups_state = ?")
            params.append(cups_state)
        if pages_printed is not None:
            parts.append("pages_printed = ?")
            params.append(pages_printed)
        if sheets_printed is not None:
            parts.append("sheets_printed = ?")
            params.append(sheets_printed)
        if result is not None:
            parts.append("result = ?")
            params.append(result)
        if error_msg is not None:
            parts.append("error_msg = ?")
            params.append(error_msg)
        if ended:
            parts.append("ended_at = CURRENT_TIMESTAMP")
        if not parts:
            return
        query += ", ".join(parts) + " WHERE id = ?"
        params.append(attempt_id)
        conn.execute(query, params)
        conn.commit()


# ---------------------------------------------------------------------------
# Outbox (durable event queue for cloud API calls)
# ---------------------------------------------------------------------------

def save_outbox_event(event_type: str, job_id: Optional[str], payload: Dict[str, Any]) -> int:
    with get_connection() as conn:
        cur = conn.execute("""
            INSERT INTO outbox_events (event_type, job_id, payload_json)
            VALUES (?, ?, ?)
        """, (event_type, job_id, json.dumps(payload)))
        conn.commit()
        return cur.lastrowid or 0


def get_pending_outbox(limit: int = 20) -> List[Dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT * FROM outbox_events
            WHERE synced = 0 AND retry_count < 10
            ORDER BY created_at ASC
            LIMIT ?
        """, (limit,)).fetchall()
        return [dict(r) for r in rows]


def mark_outbox_synced(event_id: int) -> None:
    with get_connection() as conn:
        conn.execute("""
            UPDATE outbox_events
            SET synced=1, synced_at=CURRENT_TIMESTAMP
            WHERE id=?
        """, (event_id,))
        conn.commit()


def increment_outbox_retry(event_id: int, error: str) -> None:
    with get_connection() as conn:
        conn.execute("""
            UPDATE outbox_events
            SET retry_count = retry_count + 1, last_error = ?
            WHERE id = ?
        """, (error, event_id))
        conn.commit()


# ---------------------------------------------------------------------------
# Nonce deduplication (replay protection)
# ---------------------------------------------------------------------------

def save_nonce(nonce: str, device_id: str) -> None:
    with get_connection() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO nonces (nonce, device_id) VALUES (?, ?)",
            (nonce, device_id)
        )
        conn.commit()


def nonce_exists(nonce: str) -> bool:
    with get_connection() as conn:
        row = conn.execute("SELECT 1 FROM nonces WHERE nonce=? LIMIT 1", (nonce,)).fetchone()
        return row is not None


def cleanup_old_nonces(max_age_seconds: int = 3600) -> None:
    """Remove nonces older than max_age_seconds to bound table growth."""
    with get_connection() as conn:
        conn.execute("""
            DELETE FROM nonces
            WHERE created_at < datetime('now', ? || ' seconds')
        """, (f"-{max_age_seconds}",))
        conn.commit()


# ---------------------------------------------------------------------------
# Command history
# ---------------------------------------------------------------------------

def record_command(command_id: str, command: str) -> None:
    with get_connection() as conn:
        conn.execute("""
            INSERT OR IGNORE INTO command_history (command_id, command)
            VALUES (?, ?)
        """, (command_id, command))
        conn.commit()


def complete_command(command_id: str, status: str, result: Optional[Dict] = None) -> None:
    with get_connection() as conn:
        conn.execute("""
            UPDATE command_history
            SET status=?, executed_at=CURRENT_TIMESTAMP, result_json=?
            WHERE command_id=?
        """, (status, json.dumps(result) if result else None, command_id))
        conn.commit()


def command_already_executed(command_id: str) -> bool:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT status FROM command_history WHERE command_id=? LIMIT 1",
            (command_id,)
        ).fetchone()
        return row is not None and row["status"] != "pending"


# ---------------------------------------------------------------------------
# Printer state history
# ---------------------------------------------------------------------------

def record_printer_state(printer_id: str, state: str, source: str, raw_data: Optional[Dict] = None) -> None:
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO printer_state_history (printer_id, state, source, raw_data)
            VALUES (?, ?, ?, ?)
        """, (printer_id, state, source, json.dumps(raw_data) if raw_data else None))
        conn.commit()
