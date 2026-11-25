from __future__ import annotations

import hashlib
import math
import platform
import secrets
import time
from collections import Counter, defaultdict
from importlib.metadata import version
from threading import Event, Thread

import psutil

from .common import Problem, canonical, decode, digest, ident, utc
from .db import record
from .privacy import DOMAINS, domain_scope, mask, pseudonym, safe_event, transform

FEATURE_VERSION = "pointwise-hash-v1"
MODEL_VERSION = "cpu-models-v1"
BASE_FEATURES = [
    "Login timing (sin)", "Login timing (cos)", "Failed attempts", "Late login",
    "Remote access", "VPN", "Mobile device", "Recorded failure", "Same computer",
    "Process start", "Account present", "Device present",
]
HASH_FIELDS = ("src_user", "device_id", "src_host", "process", "location", "logon_type", "auth_type")
HASH_WIDTH = 4
NAMES = BASE_FEATURES + [f"{field} bucket {index + 1}" for field in HASH_FIELDS for index in range(HASH_WIDTH)]


def isolate_split(rows: list[dict], config: dict):
    ordered = sorted(rows, key=lambda row: (row["ts"] if row["ts"] is not None else row["line"], row["line"]))
    seed = config["seed"]
    if config["split"] == "group":
        partitions = ([], [], [])
        for row in ordered:
            group = row["src_user"] or f"missing:{row['line']}"
            bucket = int(digest([seed, group])[:8], 16) % 100
            partitions[0 if bucket < 60 else 1 if bucket < 79 else 2].append(row)
        scheme = "Disjoint source-account groups assigned by a seeded hash"
    else:
        edge = int(len(rows) * 0.8)
        partitions = ([], [], ordered[edge:])
        for row in ordered[:edge]:
            reserve = int(digest([seed, row["line"]])[:8], 16) % 100 < 22
            partitions[int(reserve)].append(row)
        scheme = "First 80% by elapsed time (physical order when missing), with a fixed early privacy holdout"
    if min(map(len, partitions)) < 10:
        raise Problem("This split produced too few records. Ingest more data or choose a different supported split.")
    return *partitions, scheme


def feature_rows(rows, dataset, mechanism, secret):
    import numpy as np

    if mechanism == "E1":
        rules = {field: "mask" for field in DOMAINS}
    elif mechanism == "E2":
        rules = {field: "hmac" for field in DOMAINS if field != "location"}
    elif mechanism == "E3":
        rules = {field: "hmac" if domain in {"account", "host", "device", "process"} else "mask"
                 for field, domain in DOMAINS.items()}
    else:
        rules = {}
    scope = domain_scope(dataset, "case")
    matrix = np.zeros((len(rows), len(NAMES)), dtype=np.float32)
    for index, raw in enumerate(rows):
        row = transform(raw, rules, scope, secret, mask_value=lambda value: "[masked]" if value is not None else None) if rules else raw
        hour = row["hour"] if row["hour"] is not None else ((row["ts"] or 0) // 3600) % 24
        angle = 2 * math.pi * hour / 24
        matrix[index, :len(BASE_FEATURES)] = [
            math.sin(angle), math.cos(angle), min(row["attempts"] or 0, 15) / 15, int(hour < 6 or hour >= 22),
            int(row["access"] == "Remote"), int(row["access"] == "VPN"), int(row["device_type"] == "Mobile"),
            int(row["outcome"] == "Fail"), int(bool(row["src_host"] and row["src_host"] == row["dst_host"] and
                                                   row["src_host"] != "[masked]")),
            int(row["event_type"] == "Start"), int(bool(row["src_user"])), int(bool(row["device_id"])),
        ]
        for slot, field in enumerate(HASH_FIELDS):
            value = row[field]
            if value and value != "[masked]":
                bucket = hashlib.sha256(f"{field}\0{value}".encode()).digest()[0] % HASH_WIDTH
                matrix[index, len(BASE_FEATURES) + slot * HASH_WIDTH + bucket] = 1
    return matrix


def historical_features(matrix, rows, fitted):
    import numpy as np

    accounts, hosts, pairs = fitted
    values = []
    for row in rows:
        user, host = row["src_user"], row["src_host"]
        values.append((math.log1p(accounts[user]) / 12, math.log1p(hosts[host]) / 12,
                       math.log1p(pairs[(user, host)]) / 12, float(bool(user and host and not pairs[(user, host)]))))
    return np.concatenate([matrix, np.asarray(values, dtype=np.float32)], axis=1)


def compact_curve(x, y):
    import numpy as np

    indices = np.linspace(0, len(x) - 1, min(len(x), 200), dtype=int)
    return [[float(x[i]), float(y[i])] for i in indices]


def classification(targets, scores, threshold):
    from sklearn.metrics import (accuracy_score, average_precision_score, confusion_matrix, f1_score,
                                 precision_recall_curve, precision_score, recall_score, roc_auc_score, roc_curve)

    predicted = scores >= threshold
    tn, fp, fn, tp = (int(x) for x in confusion_matrix(targets, predicted, labels=[0, 1]).ravel())
    fpr, tpr, _ = roc_curve(targets, scores)
    precision, recall, _ = precision_recall_curve(targets, scores)
    metrics = {
        "accuracy": float(accuracy_score(targets, predicted)),
        "precision": float(precision_score(targets, predicted, zero_division=0)),
        "recall": float(recall_score(targets, predicted, zero_division=0)),
        "f1": float(f1_score(targets, predicted, zero_division=0)),
        "roc_auc": float(roc_auc_score(targets, scores)),
        "pr_auc": float(average_precision_score(targets, scores)),
        "fpr": fp / (fp + tn) if fp + tn else None,
        "fnr": fn / (fn + tp) if fn + tp else None,
    }
    return metrics, [tn, fp, fn, tp], compact_curve(fpr, tpr), compact_curve(recall[::-1], precision[::-1])


def membership_summary(train_labels, train_scores, reserve_labels, reserve_scores, seed):
    """Measure aggregate separability in a local labelled fixture with disjoint calibration and test rows."""
    import numpy as np
    from sklearn.metrics import roc_auc_score, roc_curve

    rng = np.random.default_rng(seed)
    calibration, evaluation = ([], []), ([], [])
    for label in (0, 1):
        members = rng.permutation(np.flatnonzero(train_labels == label))
        nonmembers = rng.permutation(np.flatnonzero(reserve_labels == label))
        size = min(len(members), len(nonmembers), 1000)
        if size < 6:
            return None
        cutoff = size // 2
        for target, indices in ((0, members[:size]), (1, nonmembers[:size])):
            values = (train_scores if target == 0 else reserve_scores)[indices]
            confidence = values if label == 1 else 1 - values
            calibration[target].extend(confidence[:cutoff])
            evaluation[target].extend(confidence[cutoff:])
    def distribution(groups):
        return np.array([1] * len(groups[0]) + [0] * len(groups[1])), np.asarray(groups[0] + groups[1])
    cy, cs = distribution(calibration)
    fp, tp, thresholds = roc_curve(cy, cs)
    boundary = thresholds[int(np.argmax(tp - fp))]
    ey, es = distribution(evaluation)
    guesses = es >= boundary
    test_fp, test_tp, _ = roc_curve(ey, es)
    return {
        "accuracy": float((guesses == ey).mean()), "auc": float(roc_auc_score(ey, es)),
        "advantage": float(guesses[ey == 1].mean() - guesses[ey == 0].mean()),
        "members": len(evaluation[0]), "nonmembers": len(evaluation[1]),
        "calibration_members": len(calibration[0]), "calibration_nonmembers": len(calibration[1]),
        "roc": compact_curve(test_fp, test_tp),
    }


class Resources:
    def __enter__(self):
        self.process = psutil.Process()
        self.stop = Event()
        self.initial = self.peak = self.process.memory_info().rss
        self.cpu_start = sum(self.process.cpu_times()[:2])
        self.started = time.perf_counter()
        self.thread = Thread(target=self.poll, daemon=True)
        self.thread.start()
        return self

    def poll(self):
        while not self.stop.wait(0.01):
            self.peak = max(self.peak, self.process.memory_info().rss)

    def __exit__(self, *_):
        self.stop.set()
        self.thread.join()
        self.peak = max(self.peak, self.process.memory_info().rss)
        self.elapsed = max(time.perf_counter() - self.started, 1e-9)
        self.cpu = max(0, sum(self.process.cpu_times()[:2]) - self.cpu_start) / self.elapsed * 100


def neural_fit(x, labels, config, context):
    import torch
    from torch import nn
    from torch.utils.data import DataLoader, TensorDataset

    torch.set_num_threads(1)
    torch.manual_seed(config["seed"])
    model = nn.Sequential(nn.Linear(x.shape[1], 24), nn.ReLU(), nn.Linear(24, 1))
    optimizer = torch.optim.SGD(model.parameters(), lr=0.12, momentum=0.4)
    is_private = config["model"] == "dp_neural"
    generator = torch.Generator().manual_seed(secrets.randbits(63) if is_private else config["seed"])
    loader = DataLoader(TensorDataset(torch.from_numpy(x), torch.from_numpy(labels.astype("float32"))),
                        batch_size=min(config["batch_size"], len(x)), shuffle=True, generator=generator)
    engine = None
    if is_private:
        from opacus import PrivacyEngine
        from opacus.validators import ModuleValidator

        if not 0 < config["delta"] < 1 / len(x):
            raise Problem("For this training set, choose a delta smaller than 1 divided by the training row count.")
        ModuleValidator.validate(model, strict=True)
        engine = PrivacyEngine(accountant="rdp", secure_mode=False)
        arguments = dict(module=model, optimizer=optimizer, data_loader=loader, max_grad_norm=config["clip"],
                         poisson_sampling=True,
                         noise_generator=torch.Generator().manual_seed(secrets.randbits(63)))
        if config["target_epsilon"] is not None:
            model, optimizer, loader = engine.make_private_with_epsilon(
                target_epsilon=config["target_epsilon"], target_delta=config["delta"], epochs=config["epochs"],
                **arguments,
            )
        else:
            model, optimizer, loader = engine.make_private(noise_multiplier=config["noise"], **arguments)
    criterion = nn.BCEWithLogitsLoss()
    steps = 0
    for epoch in range(config["epochs"]):
        model.train()
        for features, target in loader:
            if steps % 20 == 0:
                context.check()
            optimizer.zero_grad()
            logits = model(features).reshape(-1)
            loss = criterion(logits, target) if target.numel() else logits.sum()
            loss.backward()
            optimizer.step()
            steps += 1
        context.progress("Training neural network", epoch + 1, config["epochs"], "epochs", force=True)
    dp = None
    if engine:
        epsilon = float(engine.get_epsilon(config["delta"]))
        if not math.isfinite(epsilon):
            raise Problem("The accountant returned an unbounded estimate. Increase the noise multiplier.")
        dp = {"epsilon": epsilon, "delta": config["delta"], "accountant": "Opacus RDP",
              "noise": float(optimizer.noise_multiplier), "clip": config["clip"],
              "sampling_rate": 1 / len(loader), "steps": steps, "secure_mode": engine.secure_mode}

    def score(values):
        model.eval()
        with torch.inference_mode():
            return torch.sigmoid(model(torch.from_numpy(values)).reshape(-1)).numpy()

    return score, [], dp


class Experiments:
    def __init__(self, db, datasets, keys, evidence):
        self.db, self.datasets, self.keys, self.evidence = db, datasets, keys, evidence

    def prepare(self, case_id, config):
        dataset = self.datasets.get(config["dataset_id"])
        if dataset["case_id"] != case_id:
            raise Problem("Select a dataset that belongs to this investigation.")
        if (config["mechanism"] == "E4") != (config["model"] == "dp_neural"):
            raise Problem("DP-SGD requires the DP Neural Network and is exclusive to E4.")
        if dataset["kind"] == "redteam" or (dataset["kind"] != "synthetic" and config["model"] != "isolation_forest"):
            raise Problem("Use Isolation Forest for unlabelled LANL activity and a labelled synthetic dataset for supervised models.")
        if config["split"] == "group" and not dataset["meta"]["present"].get("src_user"):
            raise Problem("This dataset has no source account groups. Use a temporal split.")
        if dataset["rows"] < 60:
            raise Problem("The evaluation needs at least 60 validated events. Ingest a larger range.")
        if config["mechanism"] in {"E2", "E3"}:
            key_version, _ = self.keys.read(config.get("key_version"))
            config["key_version"] = key_version
        return dataset, config

    def run(self, dataset, config, context) -> dict:
        import numpy as np
        from sklearn.ensemble import IsolationForest, RandomForestClassifier

        started = utc()
        context.progress("Preparing data", 0, 5, force=True)
        points = self.datasets.sample(dataset, config["max_rows"])
        training, reserve, holdout, scheme = isolate_split(points, config)
        secret = self.keys.read(config.get("key_version"))[1] if config.get("key_version") else None
        labelled = dataset["kind"] == "synthetic"
        technique, model = config["mechanism"], config["model"]
        labels = np.asarray([row["synthetic_label"] for row in training], dtype=int) if labelled else None
        targets = np.asarray([row["synthetic_label"] for row in holdout], dtype=int) if labelled else None
        if labelled and (len(set(targets)) < 2 or len(set(labels)) < 2):
            raise Problem("The training and holdout partitions each need both synthetic label classes.")
        start_prep = time.perf_counter()
        features = [feature_rows(rows, dataset, technique, secret) for rows in (training, reserve, holdout)]
        names = NAMES
        if not labelled and technique == "E0":
            past = training
            counts = (Counter(row["src_user"] for row in past if row["src_user"]),
                      Counter(row["src_host"] for row in past if row["src_host"]),
                      Counter((row["src_user"], row["src_host"]) for row in past if row["src_user"] and row["src_host"]))
            features = [historical_features(x, rows, counts) for x, rows in zip(features, (training, reserve, holdout))]
            names = NAMES + ["Account frequency", "Host frequency", "Account–host frequency", "Unseen account–host pair"]
        x, xr, xt = features
        preprocessing = time.perf_counter() - start_prep
        context.progress("Training model", 1, 5, force=True)
        importance, dp = [], None
        with Resources() as resources:
            train_started = time.perf_counter()
            if model == "random_forest":
                estimator = RandomForestClassifier(n_estimators=config["trees"], max_depth=12,
                                                   min_samples_leaf=3, class_weight="balanced_subsample",
                                                   random_state=config["seed"], n_jobs=1)
                estimator.fit(x, labels)
                class_index = list(estimator.classes_).index(1)
                def score(values):
                    return estimator.predict_proba(values)[:, class_index]
                importance = sorted(zip(names, estimator.feature_importances_), key=lambda item: -item[1])[:12]
            elif model == "isolation_forest":
                estimator = IsolationForest(n_estimators=config["trees"], contamination="auto",
                                            random_state=config["seed"], n_jobs=1)
                estimator.fit(x)
                def score(values):
                    return -estimator.score_samples(values)
            else:
                score, importance, dp = neural_fit(x, labels, config, context)
            training_time = time.perf_counter() - train_started
            context.progress("Scoring held-out events", 3, 5, force=True)
            inference_started = time.perf_counter()
            scores = score(xt)
            inference_time = max(time.perf_counter() - inference_started, 1e-9)
            threshold = float(np.quantile(score(xr), 1 - config["contamination"])) if model == "isolation_forest" else config["threshold"]
            metrics, confusion, roc, pr = (classification(targets, scores, threshold) if labelled else ({}, None, [], []))
            member = None
            if dataset["origin"] == "fixture" and labelled and model != "isolation_forest":
                reserved = np.asarray([row["synthetic_label"] for row in reserve], dtype=int)
                member = membership_summary(labels, score(x), reserved, score(xr), config["seed"])
        flags = [int(index) for index in np.argsort(scores)[::-1] if scores[index] >= threshold]
        findings = [{"score": float(scores[index]), "event": safe_event(dataset, holdout[index])} for index in flags[:100]]
        bins = Counter(max(0, min(100, int(float(score_value) * 100 + 1e-10))) for score_value in scores)
        run_id = ident("RUN")
        saved_source = self.evidence.get(dataset["evidence_id"])
        manifest = {
            "config_hash": digest(config), "dataset_hash": dataset["sha256"], "source_sha256": saved_source["sha256"],
            "dataset_name": dataset["name"], "origin": dataset["origin"], "key_version": config.get("key_version"),
            "feature_version": FEATURE_VERSION, "model_version": MODEL_VERSION, "started_at": started, "completed_at": utc(),
            "split": {"description": scheme, "train": len(training), "privacy_holdout": len(reserve), "holdout": len(holdout),
                      "row_scope": len(points), "first_source_line": points[0]["line"], "last_source_line": points[-1]["line"]},
            "environment": {"python": platform.python_version(), "os": platform.platform(),
                            **{name: version(name) for name in ("numpy", "scikit-learn", "torch", "opacus")}},
        }
        linkage = None
        view = {"E0": "Original", "E1": "Masked", "E2": "HMAC pseudonymized", "E3": "HMAC pseudonymized"}.get(technique)
        if view and dataset["origin"] == "fixture" and labelled:
            leakage = self.linkage(dataset, [])
            linkage = next(entry for entry in leakage["results"] if entry["mechanism"] == view)
        result = {
            "linkage": linkage,
            "metrics": metrics, "confusion": confusion, "roc": roc, "pr": pr, "dp": dp, "membership": member,
            "findings": findings, "importance": [{"feature": name, "weight": float(value)} for name, value in importance],
            "counts": {"train": len(training), "holdout": len(holdout), "privacy_holdout": len(reserve), "flagged": len(flags)},
            "threshold": threshold, "score_bins": sorted(bins.items()),
            "performance": {"training_s": training_time, "inference_s": inference_time, "preprocessing_s": preprocessing,
                            "peak_rss_mb": resources.peak / 2**20, "rss_increase_mb": (resources.peak - resources.initial) / 2**20,
                            "cpu_percent": resources.cpu, "inference_rows_per_s": len(holdout) / inference_time},
        }
        context.progress("Saving reproducibility manifest", 5, 5, force=True)
        with self.db.connect(write=True) as connection:
            connection.execute("INSERT INTO runs VALUES (?,?,?,?,?,?,?)", (run_id, dataset["case_id"], dataset["id"],
                               canonical(config), canonical(manifest), canonical(result), utc()))
            record(connection, "run.completed", run_id, dataset["case_id"], {"dataset": dataset["id"], "model": model,
                   "mechanism": technique, "config_hash": manifest["config_hash"]})
        return {"run_id": run_id, "dataset_id": dataset["id"]}

    def get(self, run_id):
        return decode(self.db.one("SELECT * FROM runs WHERE id=?", (run_id,), missing="Experiment not found."),
                      "config", "manifest", "results")

    def list(self, case_id):
        fields = ("metrics", "confusion", "dp", "membership", "counts", "performance", "threshold", "linkage")
        items = [decode(row, "config", "manifest", "results") for row in self.db.rows(
            "SELECT * FROM runs WHERE case_id=? ORDER BY rowid DESC LIMIT 120", (case_id,))]
        for item in items:
            source = item["results"]
            item["results"] = {key: source.get(key) for key in fields}
        return items

    def linkage(self, dataset, context_fields):
        if dataset["origin"] != "fixture" or dataset["kind"] != "synthetic":
            raise Problem("The linkage benchmark is available only for the generated authentication fixture.")
        rows = self.datasets.sample(dataset, 3000)
        center = len(rows) // 2
        auxiliary, released = rows[:center], rows[center:]
        outcomes = []
        secret = secrets.token_bytes(32)
        for mode in ("Original", "Masked", "HMAC pseudonymized"):
            aux = defaultdict(set)
            seen = Counter()
            def context(row):
                return tuple(row.get(field) for field in context_fields)
            for row in auxiliary:
                identifier = row["src_user"]
                key = (identifier if mode in {"Original", "HMAC pseudonymized"} else mask(identifier), *context(row))
                aux[key].add(identifier)
            matches = 0
            for row in released:
                original = row["src_user"]
                # A secret, stable token is comparable within the release, but not to the public identifier directory.
                if mode == "HMAC pseudonymized":
                    identity = pseudonym(original, "account", "synthetic-benchmark", secret)
                else:
                    identity = original if mode == "Original" else mask(original)
                seen[(identity, *context(row))] += 1
                group = aux.get((identity, *context(row)), set())
                matches += group == {original}
            outcomes.append({"mechanism": mode, "success": matches / len(released), "linkability":
                             sum(count for count in seen.values() if count > 1) / len(released),
                             "matches": matches, "possible": len(released)})
        return {"n": len(released), "auxiliary_n": len(auxiliary), "results": outcomes, "fields": context_fields,
                "dataset_hash": dataset["sha256"], "assumptions": "Two disjoint generated row slices share a fictional account directory. The auxiliary view has public identifiers and selected context. It has no HMAC key or token crosswalk."}
