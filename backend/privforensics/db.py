from __future__ import annotations

import sqlite3
from contextlib import contextmanager

from .common import Config, Problem, canonical, digest, utc

SCHEMA = """
CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
  status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), name TEXT NOT NULL, path TEXT NOT NULL,
  source TEXT NOT NULL, sha256 TEXT NOT NULL, size INTEGER NOT NULL, signature TEXT NOT NULL,
  created_at TEXT NOT NULL, verified_at TEXT, verified_sha256 TEXT, integrity TEXT NOT NULL,
  UNIQUE(case_id,path,sha256)
);
CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), evidence_id TEXT NOT NULL REFERENCES evidence(id),
  kind TEXT NOT NULL, name TEXT NOT NULL, origin TEXT NOT NULL, sha256 TEXT NOT NULL,
  first_line INTEGER NOT NULL, last_line INTEGER NOT NULL, limit_rows INTEGER,
  rows INTEGER NOT NULL, malformed INTEGER NOT NULL, meta TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(evidence_id,kind,first_line,limit_rows)
);
CREATE INDEX IF NOT EXISTS datasets_case ON datasets(case_id, created_at DESC);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), type TEXT NOT NULL, label TEXT NOT NULL,
  dedupe TEXT NOT NULL, status TEXT NOT NULL, cancel_requested INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, progress TEXT NOT NULL,
  result TEXT, error TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_active ON jobs(dedupe) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS jobs_case ON jobs(case_id, created_at DESC);
CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), title TEXT NOT NULL,
  severity TEXT NOT NULL, notes TEXT NOT NULL, events TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS policies (
  dataset_id TEXT PRIMARY KEY REFERENCES datasets(id), rules TEXT NOT NULL, scope TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), dataset_id TEXT NOT NULL REFERENCES datasets(id),
  config TEXT NOT NULL, manifest TEXT NOT NULL, results TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_case ON runs(case_id, created_at DESC);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), type TEXT NOT NULL, format TEXT NOT NULL,
  sha256 TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  sequence INTEGER PRIMARY KEY, time TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, entity TEXT NOT NULL,
  case_id TEXT REFERENCES cases(id), detail TEXT NOT NULL, previous_hash TEXT NOT NULL, entry_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_case ON audit(case_id, sequence DESC);
"""


class Database:
    def __init__(self, config: Config):
        self.path = config.root / "privforensics.sqlite3"

    def prepare(self) -> None:
        with self.connect() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.executescript(SCHEMA)
        self.path.chmod(0o600)

    @contextmanager
    def connect(self, *, write: bool = False):
        connection = sqlite3.connect(self.path, timeout=12)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        try:
            if write:
                connection.execute("BEGIN IMMEDIATE")
            yield connection
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()

    def rows(self, sql: str, args=()) -> list[dict]:
        with self.connect() as connection:
            return [dict(row) for row in connection.execute(sql, args)]

    def one(self, sql: str, args=(), *, missing: str | None = None) -> dict | None:
        with self.connect() as connection:
            row = connection.execute(sql, args).fetchone()
        if row is None and missing:
            raise Problem(missing, 404)
        return dict(row) if row is not None else None


def record(connection, action: str, entity: str, case_id: str | None, detail: dict) -> None:
    previous = connection.execute("SELECT entry_hash FROM audit ORDER BY sequence DESC LIMIT 1").fetchone()
    entry = {
        "time": utc(), "actor": "Local operator", "action": action, "entity": entity,
        "case_id": case_id, "detail": canonical(detail), "previous_hash": previous[0] if previous else "0" * 64,
    }
    connection.execute(
        """INSERT INTO audit(time,actor,action,entity,case_id,detail,previous_hash,entry_hash)
           VALUES (:time,:actor,:action,:entity,:case_id,:detail,:previous_hash,:entry_hash)""",
        {**entry, "entry_hash": digest(entry)},
    )
    if case_id:
        connection.execute("UPDATE cases SET updated_at=? WHERE id=?", (entry["time"], case_id))


def verify_audit(db: Database) -> dict:
    previous = "0" * 64
    checked = 0
    with db.connect() as connection:
        for row in connection.execute("SELECT * FROM audit ORDER BY sequence"):
            entry = dict(row)
            sequence, saved_hash = entry.pop("sequence"), entry.pop("entry_hash")
            if sequence != checked + 1 or entry["previous_hash"] != previous or digest(entry) != saved_hash:
                return {"valid": False, "checked": checked, "failed_at": sequence}
            previous = saved_hash
            checked += 1
    return {"valid": True, "checked": checked, "failed_at": None}
