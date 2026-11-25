from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
VERSION = "0.1.0"
UPLOAD_LIMIT = 24 * 1024 * 1024
QUERY_LIMIT = 100
QUERY_TIMEOUT = 8
CHUNK_ROWS = 32_768


def utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def ident(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:12].upper()}"


def canonical(value) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def digest(value) -> str:
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def decode(row: dict, *fields: str) -> dict:
    for field in fields:
        if row.get(field) is not None:
            row[field] = json.loads(row[field])
    return row


def display_name(value: str) -> str:
    basename = value.replace("\\", "/").rsplit("/", 1)[-1]
    return (re.sub(r"[\x00-\x1f\x7f]", "", basename).strip() or "evidence")[:160]


class Problem(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class Config:
    root: Path
    evidence_roots: tuple[Path, ...]

    @classmethod
    def local(cls) -> Config:
        root = Path(os.environ.get("PRIVFORENSICS_DATA", str(ROOT / ".runtime"))).expanduser().resolve()
        extra = os.environ.get("PRIVFORENSICS_EVIDENCE_ROOTS", "").split(os.pathsep)
        return cls(root, (ROOT, *(Path(part).expanduser().resolve() for part in extra if part)))

    def prepare(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        for folder in ("uploads", "parquet", "reports", "fixtures", "keys", "spill"):
            (self.root / folder).mkdir(mode=0o700, exist_ok=True)
