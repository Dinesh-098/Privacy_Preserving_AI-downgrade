from __future__ import annotations

import fcntl
import os
import platform
import shutil
from collections.abc import Iterator
from contextlib import asynccontextmanager
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import urlsplit

import psutil
from fastapi import APIRouter, FastAPI, File, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .cases import Cases
from .common import CHUNK_ROWS, QUERY_LIMIT, QUERY_TIMEOUT, ROOT, UPLOAD_LIMIT, VERSION, Config, Problem, decode, display_name, ident
from .correlation import Correlation
from .data import Datasets
from .db import Database, record, verify_audit
from .demo import load_demo
from .evidence import Evidence
from .jobs import Jobs
from .experiments import Experiments
from .reporting import FORMATS, Reports, csv_piece
from .privacy import DOMAINS, Keys, Privacy, domain_scope, redact, safe_event, transform

HOSTS = ("localhost", "127.0.0.1")
DIST = ROOT / "frontend" / "dist"
KINDS = Literal["auth", "proc", "redteam", "synthetic"]
SHORT = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
CASE_STATUS = Literal["open", "in_review", "closed"]
SCOPE = Literal["dataset", "case", "workspace"]
RULE = Literal["keep", "mask", "hmac", "drop"]


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CaseInput(Payload):
    title: SHORT
    description: str = Field("", max_length=5000)


class CaseEdit(CaseInput):
    status: CASE_STATUS


class LocalInput(Payload):
    path: str = Field(min_length=1, max_length=4096)


class IngestInput(Payload):
    kind: KINDS
    mode: Literal["sample", "range", "full"] = "sample"
    start: int | None = Field(None, ge=1, le=2**63 - 1)
    count: int = Field(25_000, ge=1, le=20_000_000)
    confirm_full: bool = False


class PolicyInput(Payload):
    rules: dict[str, RULE] = Field(max_length=25)
    scope: SCOPE = "case"


class PreviewInput(PolicyInput):
    count: int = Field(8, ge=1, le=30)


class ExportInput(PolicyInput):
    confirm: bool
    count: int | None = Field(None, ge=1, le=20_000_000)


class KeyInput(Payload):
    rotate: bool = False
    confirm: bool = False


class RevealInput(Payload):
    field: SHORT
    confirmed: Literal[True]


class RelatedRef(Payload):
    dataset_id: SHORT
    line: int = Field(ge=1)


class FindingInput(Payload):
    dataset_id: SHORT
    line: int = Field(ge=1)
    window: int = Field(300, ge=1, le=86_400)
    title: SHORT
    severity: Literal["info", "low", "medium", "high", "critical"] = "medium"
    notes: str = Field("", max_length=5000)
    references: list[RelatedRef] = Field(default_factory=list, max_length=75)


class RunInput(Payload):
    dataset_id: SHORT
    model: Literal["random_forest", "isolation_forest", "neural", "dp_neural"] = "random_forest"
    mechanism: Literal["E0", "E1", "E2", "E3", "E4"] = "E0"
    seed: int = Field(419, ge=0, le=2**32 - 1)
    split: Literal["temporal", "group"] = "temporal"
    max_rows: int = Field(10_000, ge=60, le=50_000)
    threshold: float = Field(0.5, gt=0, lt=1)
    contamination: float = Field(0.10, ge=0.01, le=0.45)
    trees: int = Field(80, ge=10, le=300)
    epochs: int = Field(8, ge=1, le=40)
    batch_size: int = Field(128, ge=16, le=512)
    delta: float = Field(0.00001, ge=1e-8, le=0.01)
    noise: float = Field(1.2, ge=0.25, le=12)
    clip: float = Field(1.0, ge=0.05, le=10)
    target_epsilon: float | None = Field(None, ge=0.2, le=64)


class LinkageInput(Payload):
    fields: list[Literal["location", "device_type", "access"]] = Field(default_factory=list, max_length=3)


class ReportInput(Payload):
    type: Literal["investigation", "evidence", "correlation", "privacy", "evaluation", "leakage", "performance", "audit"]
    run_ids: list[SHORT] = Field(default_factory=list, max_length=12)
    sections: list[SHORT] = Field(default_factory=list, max_length=15)
    include_sensitive: bool = False


class ExportReport(ReportInput):
    format: Literal["pdf", "csv", "html", "md"] = "pdf"
    confirmed: Literal[True]


def versions() -> dict:
    result = {}
    for name in ("fastapi", "uvicorn", "duckdb", "pyarrow", "scikit-learn", "torch", "opacus", "numpy", "psutil"):
        try:
            result[name] = version(name)
        except PackageNotFoundError:
            result[name] = None
    return result


def filters(start, end, user, host, event_type, outcome):
    if start is not None and end is not None and start > end:
        raise Problem("The start time must be earlier than or equal to the end time.")
    return {"start": start, "end": end, "user": user, "host": host, "type": event_type, "outcome": outcome}


def attachment(filename: str) -> dict:
    return {"Content-Disposition": f'attachment; filename="{filename}"'}


def create_app(config: Config | None = None) -> FastAPI:
    config = config or Config.local()
    db = Database(config)
    cases = Cases(db)
    evidence = Evidence(config, db)
    datasets = Datasets(config, db, evidence)
    keys = Keys(config, db)
    privacy = Privacy(db, datasets, keys)
    correlation = Correlation(datasets, db)
    experiments = Experiments(db, datasets, keys, evidence)
    reports = Reports(config, db, cases, evidence, datasets, experiments, privacy)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        config.prepare()
        with (config.root / "service.lock").open("a") as lock:
            try:
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise RuntimeError("This data directory is already used by a running PrivForensics instance.") from error
            db.prepare()
            app.state.jobs = Jobs(db)
            try:
                yield
            finally:
                app.state.jobs.close()

    app = FastAPI(title="PrivForensics", version=VERSION, openapi_url="/api/openapi.json",
                  docs_url=None, redoc_url=None, lifespan=lifespan)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(HOSTS))
    api = APIRouter(prefix="/api")

    @app.middleware("http")
    async def local_origin(request: Request, call_next):
        host = request.headers.get("host", "")
        if request.url.path.startswith("/api/"):
            origin = request.headers.get("origin")
            if request.headers.get("sec-fetch-site") == "cross-site" or (
                origin and (urlsplit(origin).scheme != request.url.scheme or urlsplit(origin).netloc != host)
            ):
                return JSONResponse({"detail": "Requests must come from the local application."}, status_code=403)
            if request.url.path.endswith("/evidence/upload") and request.method == "POST":
                try:
                    size = int(request.headers.get("content-length", "0"))
                except ValueError:
                    size = 0
                if not 0 < size <= UPLOAD_LIMIT + 64 * 1024:
                    return JSONResponse({"detail": "Upload a file no larger than 24 MiB."}, status_code=413)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
        )
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(Problem)
    async def problem(_request, error):
        return JSONResponse({"detail": str(error)}, status_code=error.status)

    @app.exception_handler(RequestValidationError)
    async def bad_request(_request, error):
        locations = [".".join(str(part) for part in item["loc"] if part != "body") for item in error.errors()[:5]]
        return JSONResponse({"detail": "Check the input for " + ", ".join(locations) + "."}, status_code=422)

    @api.get("/health")
    def health():
        return {"ready": True, "version": VERSION, "key": keys.status(), "storage": str(config.root),
                "limits": {"upload_bytes": UPLOAD_LIMIT, "rows": QUERY_LIMIT, "query_seconds": QUERY_TIMEOUT,
                           "chunk_rows": CHUNK_ROWS, "workers": 1}}

    @api.get("/environment")
    def environment():
        return {"python": platform.python_version(), "os": platform.platform(), "machine": platform.machine(),
                "cores": psutil.cpu_count(logical=True), "ram": psutil.virtual_memory().total, "packages": versions(),
                "evidence_roots": [str(path) for path in config.evidence_roots], "free": shutil.disk_usage(config.root).free}

    @api.get("/cases")
    def list_cases(q: str = Query("", max_length=160), status: CASE_STATUS | None = None,
                   page: int = Query(1, ge=1), size: int = Query(30, ge=1, le=100)):
        return cases.list(q, status, page, size)

    @api.post("/cases", status_code=201)
    def create_case(body: CaseInput):
        return cases.create(body.title, body.description)

    @api.get("/cases/{case_id}")
    def case(case_id: str):
        return cases.get(case_id)

    @api.patch("/cases/{case_id}")
    def edit_case(case_id: str, body: CaseEdit):
        return cases.update(case_id, **body.model_dump())

    @api.post("/cases/{case_id}/demo", status_code=202)
    def demo(case_id: str):
        cases.get(case_id)
        return app.state.jobs.submit(case_id, "fixture", "Load example evidence", "synthetic-auth-v1",
                                     lambda context: load_demo(config, evidence, datasets, case_id, context))

    @api.get("/cases/{case_id}/evidence")
    def list_evidence(case_id: str):
        cases.get(case_id)
        return evidence.list(case_id)

    @api.post("/cases/{case_id}/evidence/local", status_code=202)
    def register_local(case_id: str, body: LocalInput):
        cases.get(case_id)
        path = evidence.user_path(body.path)
        return app.state.jobs.submit(case_id, "register", "Register evidence", str(path),
                                     lambda context: evidence.register(case_id, path, path.name, "local", context))

    @api.post("/cases/{case_id}/evidence/upload", status_code=202)
    def upload(case_id: str, file: Annotated[UploadFile, File()]):
        cases.get(case_id)
        name = display_name(file.filename or "upload")
        path = config.root / "uploads" / ident("FILE")
        count = 0
        try:
            with path.open("xb") as output:
                while chunk := file.file.read(1024 * 1024):
                    count += len(chunk)
                    if count > UPLOAD_LIMIT:
                        raise Problem("The file exceeds 24 MiB. Register its local path instead.", 413)
                    output.write(chunk)
            if not count:
                raise Problem("Choose a file with at least one byte.")
            path.chmod(0o600)
            return app.state.jobs.submit(case_id, "register", "Register uploaded evidence", path.name,
                                         lambda context: evidence.register(case_id, path, name, "upload", context))
        except BaseException:
            path.unlink(missing_ok=True)
            raise

    @api.get("/evidence/{evidence_id}")
    def evidence_detail(evidence_id: str):
        return evidence.public(evidence.get(evidence_id), detailed=True)

    @api.post("/evidence/{evidence_id}/verify", status_code=202)
    def verify_evidence(evidence_id: str):
        saved = evidence.get(evidence_id)
        return app.state.jobs.submit(saved["case_id"], "verify", "Verify evidence integrity", evidence_id,
                                     lambda context: evidence.verify(evidence_id, context))

    @api.get("/evidence/{evidence_id}/export")
    def evidence_export(evidence_id: str):
        saved = evidence.public(evidence.get(evidence_id))
        log = [decode(row, "detail") for row in db.rows(
            "SELECT * FROM audit WHERE entity=? ORDER BY sequence", (evidence_id,))]
        return JSONResponse({"evidence": saved, "custody": log}, headers=attachment(evidence_id + ".json"))

    @api.post("/evidence/{evidence_id}/ingest", status_code=202)
    def ingest(evidence_id: str, body: IngestInput):
        saved = evidence.get(evidence_id)
        first_min = 2 if body.kind == "synthetic" else 1
        first = body.start or first_min
        if first < first_min:
            raise Problem("The first physical line contains a header. Start at line 2 or later.")
        if body.mode == "full" and not body.confirm_full:
            raise Problem("Confirm the full source scan before continuing.")
        count = None if body.mode == "full" else body.count
        return app.state.jobs.submit(saved["case_id"], "ingest", "Ingest analytical dataset",
                                     [evidence_id, body.kind, first, count],
                                     lambda context: datasets.ingest(evidence_id, body.kind, first, count, context))

    @api.get("/cases/{case_id}/datasets")
    def list_datasets(case_id: str):
        cases.get(case_id)
        return datasets.list(case_id)

    @api.get("/datasets/{dataset_id}")
    def detail_dataset(dataset_id: str):
        dataset = datasets.get(dataset_id)
        saved = evidence.get(dataset["evidence_id"])
        return {**dataset, "evidence_sha256": saved["sha256"]}

    @api.get("/datasets/{dataset_id}/distribution")
    def distribution(dataset_id: str):
        dataset = datasets.get(dataset_id)
        column = {"auth": "auth_type", "proc": "event_type", "synthetic": "access"}.get(dataset["kind"])
        if not column:
            return {"field": None, "items": []}
        with datasets.query() as connection:
            counts = connection.execute(
                f"""SELECT {column}, count(*) FROM read_parquet(?) WHERE {column} IS NOT NULL
                    GROUP BY {column} ORDER BY 2 DESC, 1 LIMIT 8""", (str(datasets.parquet(dataset_id)),),
            ).fetchall()
        return {"field": column, "items": [[redact(value, column), count] for value, count in counts]}

    @api.get("/datasets/{dataset_id}/events")
    def dataset_events(dataset_id: str, page: int = Query(1, ge=1, le=1_000_000),
                       size: int = Query(40, ge=1, le=QUERY_LIMIT),
                       sort: Literal["line", "-line", "time", "-time"] = "line",
                       start: int | None = Query(None, ge=1, le=2**63 - 1),
                       end: int | None = Query(None, ge=1, le=2**63 - 1), user: str = Query("", max_length=160),
                       host: str = Query("", max_length=160), event_type: str = Query("", max_length=160),
                       outcome: str = Query("", max_length=160)):
        dataset = datasets.get(dataset_id)
        rows, total = datasets.scan(dataset, filters(start, end, user, host, event_type, outcome),
                                    page=page, size=size, sort=sort)
        return {"items": [safe_event(dataset, row) for row in rows[:size]], "total": total, "has_more": len(rows) > size}

    @api.get("/datasets/{dataset_id}/events/{line}")
    def event(dataset_id: str, line: int):
        dataset = datasets.get(dataset_id)
        return safe_event(dataset, datasets.event(dataset, line))

    @api.post("/datasets/{dataset_id}/events/{line}/reveal")
    def reveal(dataset_id: str, line: int, body: RevealInput, request: Request):
        if request.headers.get("x-privforensics-presentation") == "1":
            raise Problem("Reveal is disabled in presentation mode.", 403)
        dataset = datasets.get(dataset_id)
        if body.field not in dataset["meta"]["fields"] or body.field not in DOMAINS:
            raise Problem("The selected field does not support reveal.")
        row = datasets.event(dataset, line)
        with db.connect(write=True) as connection:
            record(connection, "field.revealed", dataset_id, dataset["case_id"], {"line": line, "field": body.field})
        return {"value": row[body.field], "seconds": 10}

    @api.get("/datasets/{dataset_id}/timeline")
    def timeline(dataset_id: str, start: int | None = Query(None, ge=1, le=2**63 - 1),
                 end: int | None = Query(None, ge=1, le=2**63 - 1), user: str = Query("", max_length=160),
                 host: str = Query("", max_length=160), cap: int = Query(600, ge=30, le=10_000),
                 include_model: bool = False):
        dataset = datasets.get(dataset_id)
        result = correlation.timeline(dataset["case_id"], dataset, filters(start, end, user, host, "", ""), cap)
        result["predictions"] = []
        if include_model:
            run = db.one("SELECT id,results FROM runs WHERE dataset_id=? ORDER BY rowid DESC LIMIT 1", (dataset_id,))
            if run:
                seen = {(event["source"]["dataset_id"], event["line"]) for event in result["events"]}
                flags = decode(run, "results")["results"]["findings"]
                for flag in flags:
                    event = flag["event"]
                    elapsed = event["time"]
                    if elapsed is None or (start is not None and elapsed < start) or (end is not None and elapsed > end):
                        continue
                    if (user or host) and (event["source"]["dataset_id"], event["line"]) not in seen:
                        continue
                    result["predictions"].append({**flag, "run_id": run["id"]})
        return result

    @api.get("/datasets/{dataset_id}/events/{line}/related")
    def related(dataset_id: str, line: int, window: int = Query(300, ge=1, le=86_400)):
        return correlation.related(datasets.get(dataset_id), line, window)

    @api.get("/cases/{case_id}/findings")
    def findings(case_id: str):
        cases.get(case_id)
        return [decode(row, "events") for row in db.rows("SELECT * FROM findings WHERE case_id=? ORDER BY rowid DESC", (case_id,))]

    @api.post("/cases/{case_id}/findings", status_code=201)
    def save_finding(case_id: str, body: FindingInput):
        dataset = datasets.get(body.dataset_id)
        if case_id != dataset["case_id"]:
            raise Problem("The event belongs to a different investigation.")
        return correlation.find(dataset, body.line, body.window, body.title, body.severity, body.notes,
                                [ref.model_dump() for ref in body.references])

    @api.get("/datasets/{dataset_id}/privacy")
    def inspect_privacy(dataset_id: str):
        return privacy.inventory(datasets.get(dataset_id))

    @api.get("/datasets/{dataset_id}/policy")
    def policy(dataset_id: str):
        return privacy.policy(datasets.get(dataset_id))

    @api.put("/datasets/{dataset_id}/policy")
    def save_policy(dataset_id: str, body: PolicyInput):
        return privacy.save(datasets.get(dataset_id), body.rules, body.scope)

    @api.post("/datasets/{dataset_id}/policy/preview")
    def policy_preview(dataset_id: str, body: PreviewInput):
        return privacy.preview(datasets.get(dataset_id), body.rules, body.scope, body.count)

    @api.post("/datasets/{dataset_id}/policy/export")
    def policy_export(dataset_id: str, body: ExportInput, request: Request):
        if not body.confirm:
            raise Problem("Confirm the data protection and export scope to continue.")
        dataset = datasets.get(dataset_id)
        fields = dataset["meta"]["fields"]
        rules = privacy.validate(dataset, body.rules)
        if request.headers.get("x-privforensics-presentation") == "1" and any(
            rules.get(field) == "keep" for field in DOMAINS
        ):
            raise Problem("Choose a protected rule for every sensitive field before exporting in presentation mode.", 403)
        scope = domain_scope(dataset, body.scope)
        selected = [field for field in fields if rules[field] != "drop"]
        if not selected:
            raise Problem("Keep or protect at least one field before exporting.")
        key_version, secret = keys.read() if "hmac" in rules.values() else (None, None)
        with db.connect(write=True) as connection:
            record(connection, "dataset.export_requested", dataset_id, dataset["case_id"],
                   {"scope": body.scope, "key_version": key_version, "rule_counts": {
                       rule: list(rules.values()).count(rule) for rule in set(rules.values())},
                    "maximum_rows": body.count})

        def chunks() -> Iterator[str]:
            yield csv_piece(selected)
            pending = []
            for row in datasets.batches(dataset, body.count):
                protected = transform({key: row[key] for key in fields}, rules, scope, secret)
                pending.append(csv_piece([redact(protected[key], key) if key not in DOMAINS and rules[key] == "keep"
                                          else protected[key] for key in selected]))
                if len(pending) == 512:
                    yield "".join(pending)
                    pending.clear()
            if pending:
                yield "".join(pending)

        return StreamingResponse(chunks(), media_type="text/csv", headers=attachment(dataset_id + "-protected.csv"))

    @api.get("/keys")
    def key_status():
        return keys.status()

    @api.post("/keys")
    def key_change(body: KeyInput):
        if body.rotate and not body.confirm:
            raise Problem("Confirm before rotating the pseudonym key.")
        return keys.change(rotate=body.rotate)

    @api.get("/jobs")
    def jobs(case_id: str | None = None):
        return app.state.jobs.list(case_id)

    @api.get("/jobs/{job_id}")
    def job(job_id: str):
        return app.state.jobs.get(job_id)

    @api.post("/jobs/{job_id}/cancel")
    def cancel(job_id: str):
        return app.state.jobs.cancel(job_id)

    def audit_filter(case_id, q, action, entity, actor, after, before):
        predicates, parameters = [], []
        for column, value, operator in (("case_id", case_id, "="), ("action", action, "="),
                                         ("entity", entity, "="), ("actor", actor, "="),
                                         ("time", after, ">="), ("time", before, "<=")):
            if value:
                predicates.append(f"{column}{operator}?")
                parameters.append(value)
        if q:
            predicates.append("(action LIKE ? OR entity LIKE ? OR detail LIKE ?)")
            parameters.extend([f"%{q}%"] * 3)
        return ("WHERE " + " AND ".join(predicates) if predicates else "", parameters)

    @api.get("/audit")
    def audit(case_id: str | None = None, action: str | None = None, entity: str | None = None,
              actor: str | None = None, after: str | None = None, before: str | None = None,
              q: str = Query("", max_length=160), page: int = Query(1, ge=1),
              size: int = Query(40, ge=1, le=100)):
        where, parameters = audit_filter(case_id, q, action, entity, actor, after, before)
        rows = db.rows(f"SELECT * FROM audit {where} ORDER BY sequence DESC LIMIT ? OFFSET ?",
                       [*parameters, size + 1, (page - 1) * size])
        return {"items": [decode(row, "detail") for row in rows[:size]], "has_more": len(rows) > size}

    @api.get("/audit/verify")
    def audit_verify():
        return verify_audit(db)

    @api.get("/audit/export")
    def audit_export(case_id: str | None = None, action: str | None = None, entity: str | None = None,
                     actor: str | None = None, after: str | None = None, before: str | None = None,
                     q: str = Query("", max_length=160)):
        where, parameters = audit_filter(case_id, q, action, entity, actor, after, before)

        def chunks():
            fields = ["sequence", "time", "actor", "action", "entity", "case_id", "detail", "previous_hash", "entry_hash"]
            yield csv_piece(fields)
            with db.connect() as connection:
                for row in connection.execute(f"SELECT * FROM audit {where} ORDER BY sequence DESC", parameters):
                    yield csv_piece([row[column] for column in fields])

        return StreamingResponse(chunks(), media_type="text/csv", headers=attachment("privforensics-audit.csv"))

    def submit_run(case_id, values):
        cases.get(case_id)
        dataset, prepared = experiments.prepare(case_id, values)
        return app.state.jobs.submit(case_id, "experiment", "Train and evaluate model", prepared,
                                     lambda context: experiments.run(dataset, prepared, context))

    @api.get("/cases/{case_id}/runs")
    def list_runs(case_id: str):
        cases.get(case_id)
        return experiments.list(case_id)

    @api.post("/cases/{case_id}/runs", status_code=202)
    def start_experiment(case_id: str, body: RunInput):
        return submit_run(case_id, body.model_dump())

    @api.get("/runs/{run_id}")
    def get_run(run_id: str):
        return experiments.get(run_id)

    @api.post("/runs/{run_id}/rerun", status_code=202)
    def rerun(run_id: str):
        run = experiments.get(run_id)
        return submit_run(run["case_id"], run["config"])

    @api.post("/datasets/{dataset_id}/linkage")
    def linkage(dataset_id: str, body: LinkageInput):
        return experiments.linkage(datasets.get(dataset_id), list(dict.fromkeys(body.fields)))

    @api.get("/cases/{case_id}/reports")
    def list_reports(case_id: str):
        return reports.list(case_id)

    def preview_for(case_id, body, request):
        if body.include_sensitive and request.headers.get("x-privforensics-presentation") == "1":
            raise Problem("Sensitive case material is unavailable in presentation mode.", 403)
        return reports.preview(case_id, body.type, body.run_ids, body.sections, body.include_sensitive)

    @api.post("/cases/{case_id}/reports/preview")
    def report_preview(case_id: str, body: ReportInput, request: Request):
        return preview_for(case_id, body, request)

    @api.post("/cases/{case_id}/reports", status_code=201)
    def create_report(case_id: str, body: ExportReport, request: Request):
        return reports.generate(case_id, body.type, body.format, preview_for(case_id, body, request))

    @api.get("/reports/{report_id}/download")
    def report_download(report_id: str):
        item = reports.get(report_id)
        path = reports.path(report_id, item["format"])
        if not path.is_file():
            raise Problem("The exported file is unavailable in local storage.", 404)
        return FileResponse(path, media_type=FORMATS[item["format"]], filename=path.name)

    app.include_router(api)

    @app.get("/{route:path}", include_in_schema=False)
    def frontend(route: str):
        if route == "api" or route.startswith("api/"):
            raise Problem("API endpoint not found.", 404)
        if route.startswith("assets/") or route in {"mark.svg", "lockup.svg", "favicon-32.png", "favicon-16.png"}:
            path = (DIST / route).resolve()
            if path.is_relative_to(DIST) and path.is_file():
                return FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable"}
                                    if route.startswith("assets/") else {})
            raise Problem("Asset not found.", 404)
        if not (DIST / "index.html").is_file():
            return JSONResponse({"detail": "Build the frontend with pnpm -C frontend build, then reload."}, status_code=503)
        return FileResponse(DIST / "index.html", headers={"Cache-Control": "no-cache"})

    return app
