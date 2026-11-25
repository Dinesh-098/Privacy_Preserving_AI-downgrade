from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Event

from .common import Problem, canonical, decode, digest, ident, utc
from .db import Database, record

logger = logging.getLogger("privforensics.jobs")


class Cancelled(Exception):
    pass


class JobContext:
    def __init__(self, db: Database, job_id: str, stopping: Event):
        self.db = db
        self.id = job_id
        self.stopping = stopping
        self.started = time.monotonic()
        self.last_update = 0.0

    def check(self) -> None:
        state = self.db.one("SELECT cancel_requested FROM jobs WHERE id=?", (self.id,))
        if self.stopping.is_set() or state["cancel_requested"]:
            raise Cancelled

    def progress(self, phase: str, current: int = 0, total: int | None = None, unit: str = "steps", *, force=False):
        now = time.monotonic()
        if not force and now - self.last_update < 0.22:
            return
        self.check()
        elapsed = max(now - self.started, 0.001)
        rate = current / elapsed if unit in {"rows", "bytes"} else None
        value = dict(
            phase=phase, current=current, total=total, unit=unit, elapsed=elapsed, rate=rate,
            eta=max(0, total - current) / rate if rate and total is not None else None,
            fraction=min(1, current / total) if total else None,
        )
        with self.db.connect(write=True) as connection:
            connection.execute("UPDATE jobs SET progress=? WHERE id=?", (canonical(value), self.id))
        self.last_update = now


class Jobs:
    def __init__(self, db: Database):
        self.db = db
        self.stopping = Event()
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="forensics")
        with db.connect(write=True) as connection:
            interrupted = connection.execute("SELECT id,case_id,type FROM jobs WHERE status IN ('queued','running')")
            for job in interrupted.fetchall():
                connection.execute(
                    "UPDATE jobs SET status='failed',finished_at=?,error=? WHERE id=?",
                    (utc(), "The application stopped before this job finished. Start it again to retry.", job["id"]),
                )
                record(connection, "job.interrupted", job["id"], job["case_id"], {"type": job["type"]})

    def submit(self, case_id, kind, label, key, operation) -> dict:
        fingerprint = digest([case_id, kind, key])
        with self.db.connect(write=True) as connection:
            existing = connection.execute(
                "SELECT id FROM jobs WHERE dedupe=? AND status IN ('queued','running')", (fingerprint,),
            ).fetchone()
            if existing:
                return self.get(existing["id"])
            job_id = ident("JOB")
            connection.execute(
                """INSERT INTO jobs(id,case_id,type,label,dedupe,status,created_at,progress)
                   VALUES (?,?,?,?,?,'queued',?,?)""",
                (job_id, case_id, kind, label, fingerprint, utc(), canonical({"phase": "Queued", "fraction": None})),
            )
            record(connection, "job.queued", job_id, case_id, {"type": kind})
        self.executor.submit(self._run, job_id, case_id, kind, operation)
        return self.get(job_id)

    def _run(self, job_id, case_id, kind, operation):
        context = JobContext(self.db, job_id, self.stopping)
        result = problem = None
        try:
            context.check()
            with self.db.connect(write=True) as connection:
                connection.execute("UPDATE jobs SET status='running',started_at=? WHERE id=?", (utc(), job_id))
            result = operation(context)
            status = "completed"
        except Cancelled:
            status, problem = "cancelled", None
        except Problem as error:
            status, problem = "failed", str(error)
        except Exception as error:
            status, problem = "failed", "Processing failed. Check the input and retry."
            logger.error("Job %s (%s) failed with %s", job_id, kind, type(error).__name__)
        with self.db.connect(write=True) as connection:
            connection.execute(
                "UPDATE jobs SET status=?,finished_at=?,result=?,error=? WHERE id=?",
                (status, utc(), canonical(result) if result is not None else None, problem, job_id),
            )
            record(connection, f"job.{status}", job_id, case_id, {"type": kind})

    @staticmethod
    def public(row: dict) -> dict:
        job = decode(row, "progress", "result")
        job["cancel_requested"] = bool(job["cancel_requested"])
        job.pop("dedupe", None)
        return job

    def get(self, job_id) -> dict:
        return self.public(self.db.one("SELECT * FROM jobs WHERE id=?", (job_id,), missing="Job not found."))

    def list(self, case_id: str | None) -> list[dict]:
        clause, args = ("WHERE case_id=?", (case_id,)) if case_id else ("", ())
        return [self.public(row) for row in self.db.rows(
            f"SELECT * FROM jobs {clause} ORDER BY rowid DESC LIMIT 75", args)]

    def cancel(self, job_id: str) -> dict:
        with self.db.connect(write=True) as connection:
            connection.execute("UPDATE jobs SET cancel_requested=1 WHERE id=? AND status IN ('queued','running')",
                               (job_id,))
        return self.get(job_id)

    def close(self) -> None:
        self.stopping.set()
        self.executor.shutdown(wait=True)
