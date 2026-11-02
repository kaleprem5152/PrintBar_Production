"""
Local SQLite database for the PrintBar Raspberry Pi Agent.
Provides crash recovery and state tracking for active and recent print jobs.
"""
import sqlite3
import json
from datetime import datetime
from typing import Optional, Dict, Any, List
from config import SQLITE_DB_PATH

def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(SQLITE_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS local_jobs (
                order_id TEXT PRIMARY KEY,
                job_ref TEXT,
                printer_name TEXT,
                cups_job_id TEXT,
                status TEXT,
                pages_to_print INTEGER,
                pages_printed INTEGER DEFAULT 0,
                color_mode TEXT,
                copies INTEGER DEFAULT 1,
                settings_json TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()

def record_job_claimed(order_id: str, job_ref: str, printer_name: str, pages_to_print: int, color_mode: str, copies: int, settings: Dict[str, Any]):
    with get_connection() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO local_jobs (
                order_id, job_ref, printer_name, status, pages_to_print, pages_printed, color_mode, copies, settings_json, updated_at
            ) VALUES (?, ?, ?, 'claimed', ?, 0, ?, ?, ?, CURRENT_TIMESTAMP)
        """, (order_id, job_ref, printer_name, pages_to_print, color_mode, copies, json.dumps(settings)))
        conn.commit()

def update_job_progress(order_id: str, pages_printed: int, cups_job_id: Optional[str] = None, status: Optional[str] = None):
    with get_connection() as conn:
        query = "UPDATE local_jobs SET pages_printed = ?, updated_at = CURRENT_TIMESTAMP"
        params = [pages_printed]
        if cups_job_id:
            query += ", cups_job_id = ?"
            params.append(cups_job_id)
        if status:
            query += ", status = ?"
            params.append(status)
        query += " WHERE order_id = ?"
        params.append(order_id)
        conn.execute(query, params)
        conn.commit()

def mark_job_completed(order_id: str):
    with get_connection() as conn:
        conn.execute("UPDATE local_jobs SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE order_id = ?", (order_id,))
        conn.commit()

def mark_job_failed(order_id: str):
    with get_connection() as conn:
        conn.execute("UPDATE local_jobs SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE order_id = ?", (order_id,))
        conn.commit()

def get_active_job() -> Optional[Dict[str, Any]]:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM local_jobs WHERE status IN ('claimed', 'processing', 'printing', 'fallback_pending', 'fallback_printing') ORDER BY updated_at DESC LIMIT 1").fetchone()
        if row:
            return dict(row)
        return None
