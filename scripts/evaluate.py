#!/usr/bin/env python3
"""Run the reproducible synthetic research matrix through the same API used by the UI."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT)]

from fastapi.testclient import TestClient

from dataset.generate_dataset import generate
from privforensics.api import create_app
from privforensics.common import Config


def success(response):
    response.raise_for_status()
    return response.json()


def finish(client, response):
    job_id = success(response)["id"]
    for _ in range(2400):
        job = success(client.get("/api/jobs/" + job_id))
        if job["status"] == "completed":
            return job["result"]
        if job["status"] in {"failed", "cancelled"}:
            raise RuntimeError(job["error"] or job["status"])
        time.sleep(0.1)
    raise TimeoutError(job_id)


def benchmark(directory, args):
    root = Path(directory).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    with TestClient(create_app(Config(root / "state", (root,))), base_url="http://127.0.0.1") as client:
        summary = success(client.get("/api/cases", params={"q": "Synthetic evaluation fixture"}))
        case = next(iter(summary["items"]), None) or success(client.post(
            "/api/cases", json={"title": "Synthetic evaluation fixture"}))
        base = "/api/cases/" + case["id"]
        finish(client, client.post(base + "/demo"))
        success(client.post("/api/keys", json={}))
        datasets = success(client.get(base + "/datasets"))
        primary = next(item for item in datasets if item["kind"] == "synthetic")
        measurements = []
        configs = [
            ("E0", "random_forest", 1.2), ("E1", "random_forest", 1.2), ("E2", "random_forest", 1.2),
            ("E3", "random_forest", 1.2), ("E0", "neural", 1.2),
            ("E4", "dp_neural", 0.85), ("E4", "dp_neural", 1.2), ("E4", "dp_neural", 2.5),
        ]
        for seed in args.seeds:
            for mechanism, model, noise in configs:
                settings = {
                    "dataset_id": primary["id"], "mechanism": mechanism, "model": model, "seed": seed,
                    "max_rows": 10_000, "trees": 80, "epochs": 12, "batch_size": 128, "noise": noise,
                }
                completed = finish(client, client.post(base + "/runs", json=settings))
                run = success(client.get("/api/runs/" + completed["run_id"]))
                run["results"].pop("findings")
                measurements.append(run)
                values = run["results"]
                measured = values["dp"]["epsilon"] if values["dp"] else None
                print(f"{seed} {mechanism:2} {model:15} F1={values['metrics']['f1']:.4f} epsilon={measured}", flush=True)
        linkage = [success(client.post("/api/datasets/" + primary["id"] + "/linkage", json={"fields": fields}))
                   for fields in ([], ["location", "device_type"], ["location", "device_type", "access"])]
        ingestion = None
        if args.medium_rows:
            path = root / f"medium-synthetic-{args.medium_rows}.csv"
            if not path.exists():
                generate(path, args.medium_rows)
            evidence = finish(client, client.post(base + "/evidence/local", json={"path": str(path)}))
            ingestion = finish(client, client.post("/api/evidence/" + evidence["id"] + "/ingest",
                                                   json={"kind": "synthetic", "mode": "full", "confirm_full": True}))
            print(f"Ingested {ingestion['rows']:,} medium fixture rows at {ingestion['meta']['rows_per_s']:,.0f} rows/s",
                  flush=True)
        environment = success(client.get("/api/environment"))
        return {"run_count": len(measurements), "seeds": args.seeds, "environment": environment,
                "fixture": {**primary, "meta": {key: primary["meta"][key] for key in ("schema_version", "label_counts")}},
                "runs": measurements, "aggregate_linkage": linkage,
                "medium_ingestion": None if ingestion is None else {
                    "rows": ingestion["rows"], "malformed": ingestion["malformed"], "source_lines": ingestion["last_line"],
                    **{key: ingestion["meta"][key] for key in ("bytes_read", "duration_s", "rows_per_s", "mb_per_s")},
                }}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "docs/research/measurements.json")
    parser.add_argument("--seeds", type=int, nargs="+", default=[419, 420, 421])
    parser.add_argument("--storage", type=Path, help="Keep this isolated case and key for exact HMAC reruns.")
    parser.add_argument("--medium-rows", type=int, default=250_000)
    args = parser.parse_args()
    if not 0 <= args.medium_rows <= 1_000_000 or any(not 0 <= seed < 2**32 for seed in args.seeds):
        parser.error("Use seeds within the 32-bit unsigned range and 0 to 1,000,000 medium rows.")
    if args.storage:
        results = benchmark(args.storage, args)
    else:
        with TemporaryDirectory(prefix="privforensics-study-") as storage:
            results = benchmark(storage, args)
    # Avoid publishing temporary host paths or current disk-space snapshots.
    for key in ("evidence_roots", "free"):
        results["environment"].pop(key, None)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(results, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(f"Wrote {results['run_count']} actual runs to {args.output}")
