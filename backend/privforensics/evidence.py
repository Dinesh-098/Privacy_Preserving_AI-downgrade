from __future__ import annotations

import hashlib
import os
import stat
from contextlib import contextmanager
from pathlib import Path

from .common import Config, Problem, canonical, decode, display_name, ident, utc
from .db import Database, record

BLOCK_SIZE = 4 * 1024 * 1024


def fingerprint(info: os.stat_result) -> list[int]:
    return [info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns]


@contextmanager
def opened_file(path: Path):
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError as error:
        raise Problem("The evidence file could not be opened. Check its path and read permissions.") from error
    with os.fdopen(descriptor, "rb") as file:
        info = os.fstat(file.fileno())
        if not stat.S_ISREG(info.st_mode):
            raise Problem("Select a regular file.")
        yield file, info


def assert_stable(path: Path, file, before: os.stat_result) -> None:
    try:
        current = path.stat(follow_symlinks=False)
    except OSError as error:
        raise Problem("The source file moved during processing. Restore it before retrying.") from error
    if fingerprint(before) != fingerprint(os.fstat(file.fileno())) or fingerprint(before) != fingerprint(current):
        raise Problem("The source changed during processing. Verify or register the current file before retrying.")


def sha256_file(path: Path, context=None, *, phase="Hashing evidence") -> tuple[str, os.stat_result]:
    checksum = hashlib.sha256()
    current = 0
    with opened_file(path) as (file, info):
        if context:
            context.progress(phase, 0, info.st_size, "bytes", force=True)
        for block in iter(lambda: file.read(BLOCK_SIZE), b""):
            checksum.update(block)
            current += len(block)
            if context:
                context.progress(phase, current, info.st_size, "bytes")
        assert_stable(path, file, info)
        if context:
            context.progress(phase, current, info.st_size, "bytes", force=True)
    return checksum.hexdigest(), info


class Evidence:
    def __init__(self, config: Config, db: Database):
        self.config, self.db = config, db

    def user_path(self, value: str) -> Path:
        path = Path(value).expanduser()
        if not path.is_absolute() or ".." in path.parts:
            raise Problem("Enter an absolute path without parent-directory segments.")
        try:
            resolved = path.resolve(strict=True)
        except (OSError, RuntimeError) as error:
            raise Problem("The path is unavailable. Check the file name and permissions.") from error
        if resolved.is_relative_to(self.config.root):
            raise Problem("Choose a source outside the application's data directory.")
        for root in self.config.evidence_roots:
            if resolved.is_relative_to(root):
                relative = resolved.relative_to(root)
                if any(part.startswith(".") or part in {"node_modules", "__pycache__"} for part in relative.parts):
                    break
                if resolved.is_file():
                    return resolved
                break
        raise Problem("Choose a regular file in the project or a configured evidence directory.")

    def get(self, evidence_id: str) -> dict:
        return decode(self.db.one("SELECT * FROM evidence WHERE id=?", (evidence_id,), missing="Evidence not found."),
                      "signature")

    @staticmethod
    def public(row: dict, *, detailed=False) -> dict:
        data = {key: value for key, value in row.items() if key not in {"signature", "path"}}
        if detailed and row["source"] == "local":
            data["path"] = row["path"]
        return data

    def list(self, case_id: str) -> list[dict]:
        return [self.public(row) for row in self.db.rows(
            "SELECT * FROM evidence WHERE case_id=? ORDER BY rowid DESC", (case_id,))]

    def register(self, case_id, path: Path, name: str, source: str, context) -> dict:
        if source == "local":
            path = self.user_path(str(path))
        checksum, info = sha256_file(path, context)
        row = self.db.one("SELECT * FROM evidence WHERE case_id=? AND path=? AND sha256=?",
                          (case_id, str(path), checksum))
        if row:
            return self.public(row)
        evidence_id = ident("EV")
        with self.db.connect(write=True) as connection:
            connection.execute(
                """INSERT INTO evidence(id,case_id,name,path,source,sha256,size,signature,created_at,integrity)
                   VALUES (?,?,?,?,?,?,?,?,?,'registered')""",
                (evidence_id, case_id, display_name(name), str(path), source, checksum, info.st_size,
                 canonical(fingerprint(info)), utc()),
            )
            record(connection, "evidence.registered", evidence_id, case_id, {"sha256": checksum, "size": info.st_size})
        return self.public(self.get(evidence_id))

    def verify(self, evidence_id: str, context) -> dict:
        row = self.get(evidence_id)
        checksum, info = sha256_file(Path(row["path"]), context, phase="Verifying registered hash")
        matched = checksum == row["sha256"]
        state = "verified" if matched else "mismatch"
        with self.db.connect(write=True) as connection:
            connection.execute("""UPDATE evidence SET integrity=?,verified_at=?,verified_sha256=?,
                                  signature=CASE WHEN ? THEN ? ELSE signature END WHERE id=?""",
                               (state, utc(), checksum, matched, canonical(fingerprint(info)), evidence_id))
            record(connection, f"evidence.{state}", evidence_id, row["case_id"],
                   {"registered": row["sha256"], "recomputed": checksum})
        return self.public(self.get(evidence_id))
