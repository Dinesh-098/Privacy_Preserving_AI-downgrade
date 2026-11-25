from __future__ import annotations

import csv
import gzip
import itertools

import time
import zlib
from collections import Counter
from contextlib import contextmanager
from pathlib import Path
from threading import Timer

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

from .common import CHUNK_ROWS, QUERY_TIMEOUT, Config, Problem, canonical, decode, digest, ident, utc
from .db import Database, record
from .evidence import Evidence, assert_stable, fingerprint, opened_file

LANL = {
    "auth": ("ts", "src_user", "dst_user", "src_host", "dst_host", "auth_type", "logon_type", "orientation", "outcome"),
    "proc": ("ts", "src_user", "src_host", "process", "event_type"),
    "redteam": ("ts", "src_user", "src_host", "dst_host"),
}
SYNTHETIC = {
    "User_ID": "src_user", "Email": "email", "IP_Address": "ip", "Login_Hour": "hour",
    "Failed_Attempts": "attempts", "Access_Type": "access", "Device_Type": "device_type",
    "Location": "location", "Status": "synthetic_label",
    "Elapsed_Seconds": "ts", "Device_ID": "device_id", "Phone": "phone",
}
REQUIRED = set(list(SYNTHETIC)[:9])
SCHEMAS = {**LANL, "synthetic": tuple(SYNTHETIC.values())}
SCHEMA_VERSION = "events-v1"
NAMES = {"auth": "Authentication", "proc": "Process", "redteam": "Red-team reference", "synthetic": "Synthetic authentication"}
TYPES = {
    "line": pa.int64(), "ts": pa.int64(), "hour": pa.int16(), "attempts": pa.int16(), "synthetic_label": pa.int8(),
}
SCHEMA = pa.schema([(key, TYPES.get(key, pa.string())) for key in
                    dict.fromkeys(["line", *(field for fields in SCHEMAS.values() for field in fields)])])
MAX_LINE = 16_384
STATUS_VALUES = {"normal": 0, "suspicious": 1}


class InvalidRow(ValueError):
    pass


def field(value: str) -> str | None:
    value = value.strip()
    if len(value) > 512 or any(ord(char) < 32 for char in value):
        raise InvalidRow("Oversized field or control character")
    return value if value and value != "?" else None


def integer(value: str | None, lower: int, upper: int = 2**63 - 1) -> int:
    try:
        number = int(value or "")
    except ValueError as error:
        raise InvalidRow("Missing or non-integer number") from error
    if not lower <= number <= upper:
        raise InvalidRow("Number outside its allowed range")
    return number


def parse_csv(raw: bytes | None, *, header=False) -> list[str]:
    if raw is None:
        raise InvalidRow("Record exceeds the line-length limit")
    try:
        return next(csv.reader([raw.decode("utf-8-sig" if header else "utf-8").rstrip("\r\n")], strict=True))
    except UnicodeDecodeError as error:
        raise InvalidRow("Invalid UTF-8") from error
    except csv.Error as error:
        raise InvalidRow("Invalid CSV syntax") from error


def parse_row(raw, kind: str, line: int, header: list[str] | None) -> dict:
    fields = header if kind == "synthetic" else LANL[kind]
    items = parse_csv(raw)
    if len(items) != len(fields):
        raise InvalidRow("Unexpected field count")
    row = {"line": line}
    for key, value in zip(fields, items):
        if kind == "synthetic":
            key = SYNTHETIC.get(key)
            if key is None:
                continue
        row[key] = field(value)
    if kind != "synthetic":
        row["ts"] = integer(row["ts"], 1)
        if kind == "auth" and row["outcome"] not in {None, "Success", "Fail"}:
            raise InvalidRow("Unknown authentication outcome")
        if kind == "proc" and row["event_type"] not in {None, "Start", "End"}:
            raise InvalidRow("Unknown process event type")
        return row
    row["hour"] = integer(row["hour"], 0, 23)
    row["attempts"] = integer(row["attempts"], 0, 32_767)
    if row.get("ts") is not None:
        row["ts"] = integer(row["ts"], 1)
    label = (row["synthetic_label"] or "").lower()
    if label not in STATUS_VALUES:
        raise InvalidRow("Unknown synthetic label")
    row["synthetic_label"] = STATUS_VALUES[label]
    return row


def iter_lines(stream, context):
    line = 0
    while raw := stream.readline(MAX_LINE + 1):
        line += 1
        if len(raw) > MAX_LINE:
            while raw and not raw.endswith(b"\n"):
                raw = stream.readline(MAX_LINE + 1)
                context.check()
            raw = None
        yield line, raw


class Profile:
    def __init__(self):
        self.counts = Counter()
        self.labels = Counter()
        self.errors = Counter()
        self.error_examples = []
        self.bins = Counter()
        self.width = 300
        self.low = self.high = None

    def add(self, row):
        self.counts.update(key for key, value in row.items() if value is not None)
        if row.get("synthetic_label") is not None:
            self.labels[str(row["synthetic_label"])] += 1
        ts = row.get("ts")
        if ts is None:
            return
        self.low = ts if self.low is None else min(self.low, ts)
        self.high = ts if self.high is None else max(self.high, ts)
        self.bins[ts // self.width] += 1
        if len(self.bins) > 180:
            coarser = Counter()
            for bucket, count in self.bins.items():
                coarser[bucket // 2] += count
            self.bins = coarser
            self.width *= 2

    def reject(self, line, reason):
        self.errors[reason] += 1
        if len(self.error_examples) < 30:
            self.error_examples.append({"line": line, "reason": reason})

    def meta(self, elapsed, size, rows, clock):
        return {
            "schema_version": SCHEMA_VERSION, "present": self.counts, "label_counts": self.labels,
            "errors": self.errors, "error_examples": self.error_examples,
            "bins": [[key * self.width, count] for key, count in sorted(self.bins.items())],
            "bin_seconds": self.width, "min_time": self.low, "max_time": self.high,
            "duration_s": elapsed, "bytes_read": size, "rows_per_s": rows / elapsed,
            "mb_per_s": size / 1_000_000 / elapsed, "clock": clock,
        }


class Datasets:
    def __init__(self, config: Config, db: Database, evidence: Evidence):
        self.config, self.db, self.evidence = config, db, evidence

    def get(self, dataset_id: str) -> dict:
        return decode(self.db.one("SELECT * FROM datasets WHERE id=?", (dataset_id,), missing="Dataset not found."), "meta")

    def list(self, case_id: str) -> list[dict]:
        return [decode(row, "meta") for row in self.db.rows(
            "SELECT * FROM datasets WHERE case_id=? ORDER BY rowid DESC", (case_id,))]

    def parquet(self, dataset_id: str) -> Path:
        return self.config.root / "parquet" / f"{dataset_id}.parquet"

    def ingest(self, evidence_id: str, kind: str, first: int, limit: int | None, context) -> dict:
        saved = self.evidence.get(evidence_id)
        existing = self.db.one(
            "SELECT id FROM datasets WHERE evidence_id=? AND kind=? AND first_line=? AND limit_rows IS ?",
            (evidence_id, kind, first, limit),
        )
        if existing:
            return self.get(existing["id"])
        source = Path(saved["path"])
        dataset_id = ident("DATA")
        output = self.parquet(dataset_id)
        partial = output.with_suffix(".partial")
        profile = Profile()
        rows, last, source_bytes = 0, first - 1, 0
        started = time.monotonic()
        chunk = []
        try:
            with opened_file(source) as (raw, info):
                if saved["integrity"] == "mismatch" or fingerprint(info) != saved["signature"]:
                    raise Problem("The evidence changed after registration. Verify its integrity before ingesting.")
                compressed = raw.peek(2)[:2] == b"\x1f\x8b"
                if saved["name"].lower().endswith(".gz") and not compressed:
                    raise Problem("The .gz source does not contain a gzip stream.")
                stream = gzip.GzipFile(fileobj=raw) if compressed else raw
                try:
                    lines = iter_lines(stream, context)
                    header = None
                    if kind == "synthetic":
                        try:
                            _, row = next(lines)
                            header = [name.strip() for name in parse_csv(row, header=True)]
                            if not REQUIRED.issubset(header) or len(set(header)) != len(header):
                                raise InvalidRow("Invalid synthetic header")
                        except (StopIteration, InvalidRow) as error:
                            raise Problem("Synthetic CSV requires the documented authentication header.") from error
                    context.progress("Reading source", 0, limit or info.st_size, "rows" if limit else "bytes", force=True)
                    if limit is not None:
                        remaining = limit + max(0, first - (2 if header else 1))
                        lines = itertools.islice(lines, remaining)
                    with pq.ParquetWriter(partial, SCHEMA, compression="zstd", write_statistics=True) as writer:
                        for line, content in lines:
                            if line < first:
                                if line % 2048 == 0:
                                    context.progress("Seeking source line", raw.tell(), info.st_size, "bytes")
                                continue
                            last = line
                            try:
                                item = parse_row(content, kind, line, header)
                            except InvalidRow as error:
                                profile.reject(line, str(error))
                            else:
                                rows += 1
                                chunk.append(item)
                                profile.add(item)
                                if len(chunk) >= CHUNK_ROWS:
                                    writer.write_table(pa.Table.from_pylist(chunk, schema=SCHEMA))
                                    chunk.clear()
                            if line % 2048 == 0:
                                context.progress("Validating and indexing", line - first + 1 if limit else raw.tell(),
                                                 limit or info.st_size, "rows" if limit else "bytes")
                        if chunk:
                            writer.write_table(pa.Table.from_pylist(chunk, schema=SCHEMA))
                    source_bytes = raw.tell()
                    assert_stable(source, raw, info)
                finally:
                    if compressed:
                        stream.close()
            if last < first:
                raise Problem("The requested range has no data records. Check the starting line and source format.")
            context.progress("Saving dataset", last - first + 1 if limit else source_bytes, limit or info.st_size,
                             "rows" if limit else "bytes", force=True)
            origin = "fixture" if saved["source"] == "fixture" else ("synthetic" if kind == "synthetic" else "registered")
            clock = {"fixture": "lanl-shaped-fixture", "registered": "lanl-cyber1"}.get(origin)
            if kind == "synthetic":
                clock = "synthetic-auth"
            meta = profile.meta(max(time.monotonic() - started, 0.000001), source_bytes, rows, clock)
            version = digest([saved["sha256"], kind, first, last, SCHEMA_VERSION])
            if kind == "synthetic":
                meta["fields"] = [SYNTHETIC[name] for name in header if name in SYNTHETIC]
            else:
                meta["fields"] = list(LANL[kind])
            malformed = sum(profile.errors.values())
            partial.replace(output)
            try:
                with self.db.connect(write=True) as connection:
                    connection.execute("INSERT INTO datasets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                                       (dataset_id, saved["case_id"], evidence_id, kind, saved["name"], origin, version,
                                        first, last, limit, rows, malformed, canonical(meta), utc()))
                    record(connection, "dataset.ingested", dataset_id, saved["case_id"],
                           {"evidence": evidence_id, "rows": rows, "malformed": malformed, "first": first, "last": last})
            except BaseException:
                output.unlink(missing_ok=True)
                raise
        except (gzip.BadGzipFile, EOFError, zlib.error) as error:
            raise Problem("The gzip stream is damaged or incomplete. Verify the evidence and use a complete source.") from error
        finally:
            partial.unlink(missing_ok=True)
        return self.get(dataset_id)

    @contextmanager
    def query(self):
        connection = duckdb.connect(config={
            "memory_limit": "192MB", "threads": "2", "temp_directory": str(self.config.root / "spill"),
            "max_temp_directory_size": "512MB", "autoinstall_known_extensions": "false",
            "autoload_known_extensions": "false", "allow_unsigned_extensions": "false",
        })
        timeout = Timer(QUERY_TIMEOUT, connection.interrupt)
        timeout.start()
        try:
            yield connection
        except duckdb.InterruptException as error:
            raise Problem("The query reached its time limit. Narrow the filters and retry.", 408) from error
        except duckdb.OutOfMemoryException as error:
            raise Problem("The query reached its memory budget. Narrow the filters or ingest a smaller range.", 413) from error
        finally:
            timeout.cancel()
            timeout.join()
            connection.close()

    def columns(self, dataset: dict) -> list[str]:
        return dataset["meta"]["fields"]

    def scan(self, dataset: dict, filters: dict, *, page: int, size: int, sort: str) -> tuple[list[dict], int | None]:
        conditions, args = make_filters(filters)
        table = str(self.parquet(dataset["id"]))
        order = {
            "line": "line ASC", "-line": "line DESC",
            "time": "ts ASC NULLS LAST, line ASC", "-time": "ts DESC NULLS LAST, line DESC",
        }[sort]
        with self.query() as connection:
            where = " WHERE " + " AND ".join(conditions) if conditions else ""
            cursor = connection.execute(f"SELECT * FROM read_parquet(?){where} ORDER BY {order} LIMIT ? OFFSET ?",
                                        [table, *args, size + 1, (page - 1) * size])
            result = as_dicts(cursor)
        return result, None if conditions else dataset["rows"]

    def event(self, dataset: dict, line: int) -> dict:
        with self.query() as connection:
            result = as_dicts(connection.execute("SELECT * FROM read_parquet(?) WHERE line=? LIMIT 1",
                                                (str(self.parquet(dataset["id"])), line)))
        if not result:
            raise Problem("No validated event was found at that source line.", 404)
        return result[0]

    def sample(self, dataset: dict, limit: int) -> list[dict]:
        rows, _ = self.scan(dataset, {}, page=1, size=limit, sort="line")
        return rows[:limit]

    def batches(self, dataset: dict, limit=None):
        file = pq.ParquetFile(self.parquet(dataset["id"]))
        count = 0
        for batch in file.iter_batches(batch_size=2048):
            for row in batch.to_pylist():
                if limit is not None and count >= limit:
                    return
                count += 1
                yield row


def as_dicts(cursor):
    names = [column[0] for column in cursor.description]
    return [dict(zip(names, row)) for row in cursor.fetchall()]


def make_filters(filters: dict):
    conditions, args = [], []
    if filters.get("start") is not None:
        conditions.append("ts >= ?")
        args.append(filters["start"])
    if filters.get("end") is not None:
        conditions.append("ts <= ?")
        args.append(filters["end"])
    for key, columns in (("user", ("src_user", "dst_user")), ("host", ("src_host", "dst_host")),
                         ("type", ("event_type", "auth_type", "access")), ("outcome", ("outcome",))):
        if filters.get(key):
            conditions.append("(" + " OR ".join(f"{column}=?" for column in columns) + ")")
            args.extend([filters[key]] * len(columns))
    return conditions, args


def source_reference(dataset: dict, row: dict) -> dict:
    return {
        "dataset_id": dataset["id"], "dataset_hash": dataset["sha256"], "evidence_id": dataset["evidence_id"],
        "line": row["line"], "name": dataset["name"], "clock": dataset["meta"]["clock"], "origin": dataset["origin"],
    }


def label_status(dataset: dict, row: dict) -> str:
    if dataset["kind"] == "synthetic":
        return "Synthetic label"
    if dataset["kind"] == "redteam":
        return "Fixture reference" if dataset["origin"] == "fixture" else "Known red-team"
    return "Unlabelled"
