from __future__ import annotations

import hashlib
import hmac
import ipaddress
import os
import re
from collections import Counter
from pathlib import Path
from threading import RLock

from .common import Config, Problem, canonical, decode, ident, utc
from .data import Datasets, label_status, source_reference
from .db import Database, record

DOMAINS = {
    "src_user": "account", "dst_user": "account", "src_host": "host", "dst_host": "host",
    "email": "email", "ip": "ip", "phone": "phone", "device_id": "device",
    "process": "process", "location": "location",
}
EMAIL = re.compile(r"[\w.!#$%&'*+/=?^_{}~-]+@(?:[\w-]+\.)+[A-Za-z]{2,63}")
IP = re.compile(r"(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])|(?<![\w:])(?:[A-Fa-f\d]{0,4}:){2,7}[A-Fa-f\d]{0,4}(?![\w:])")
PHONE = re.compile(r"(?<!\d)(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}(?!\d)")
ACCOUNT = re.compile(r"\b(?:U\d+|C\d+\$?|SYSTEM|LOCAL SERVICE|ANONYMOUS LOGON)@[\w.-]+\b", re.I)
DEVICE = re.compile(r"\b(?:DEV-\d+|C\d{1,9})\b")
DETECTORS = {"Email": EMAIL, "Phone": PHONE, "IP address": IP, "Account identifier": ACCOUNT, "Device identifier": DEVICE}
FIELD_TYPES = {
    "account": "Account identifier", "host": "Device identifier", "device": "Device identifier",
    "email": "Email", "ip": "IP address", "phone": "Phone", "location": "Location attribute",
    "process": "Process identifier",
}


def match_is_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
        return True
    except ValueError:
        return False


def detect(text: str) -> list[str]:
    return [kind for kind, pattern in DETECTORS.items()
            if (any(match_is_ip(match.group()) for match in pattern.finditer(text)) if kind == "IP address"
                else pattern.search(text))]


def mask(value):
    if value is None:
        return None
    text = str(value)
    if "@" in text and len(text) > 5:
        left, right = text.split("@", 1)
        return f"{left[:1]}••••@{right[:1]}••••"
    return "••••" if len(text) < 6 else f"{text[:2]}••••{text[-1:]}"


def redact_text(value: str) -> str:
    for kind in ("Email", "Phone", "IP address", "Account identifier", "Device identifier"):
        value = DETECTORS[kind].sub(lambda match: str(mask(match.group()))
                                    if kind != "IP address" or match_is_ip(match.group()) else match.group(), value)
    return value


def redact(value, key: str):
    if value is None:
        return None
    if key in DOMAINS:
        return mask(value)
    return redact_text(value) if isinstance(value, str) else value


def safe_event(dataset: dict, row: dict) -> dict:
    fields = {key: redact(row.get(key), key) for key in dataset["meta"]["fields"]}
    if dataset["kind"] == "synthetic":
        label = fields.get("synthetic_label")
        fields["synthetic_label"] = "Suspicious" if label == 1 else "Normal" if label == 0 else None
    return {
        "line": row["line"], "time": row["ts"], "kind": dataset["kind"],
        "label_status": label_status(dataset, row), "fields": fields, "source": source_reference(dataset, row),
    }


class Keys:
    def __init__(self, config: Config, db: Database):
        self.path, self.db = config.root / "keys", db
        self.lock = RLock()

    def status(self) -> dict:
        with self.lock:
            try:
                version = (self.path / "current").read_text().strip()
            except FileNotFoundError:
                return {"configured": False, "version": None, "created_at": None}
            return {"configured": True, "version": version, "created_at":
                    (self.path / f"{version}.time").read_text().strip()}

    def change(self, *, rotate: bool) -> dict:
        with self.lock:
            active = self.status()
            if active["configured"] and not rotate:
                return active
            version = ident("KEY")
            now = utc()
            fd = os.open(self.path / f"{version}.bin", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as stream:
                stream.write(os.urandom(32))
                stream.flush()
                os.fsync(stream.fileno())
            (self.path / f"{version}.time").write_text(now)
            pointer = self.path / f"{version}.new"
            pointer.write_text(version)
            pointer.replace(self.path / "current")
            with self.db.connect(write=True) as connection:
                record(connection, "key.rotated" if active["configured"] else "key.generated", version, None, {})
            return self.status()

    def read(self, version: str | None = None) -> tuple[str, bytes]:
        with self.lock:
            version = version or self.status()["version"]
            if not version or not re.fullmatch(r"KEY-[A-F0-9]{12}", version):
                raise Problem("Generate a local pseudonym key in Privacy Protection before using HMAC.")
            try:
                secret = (self.path / f"{version}.bin").read_bytes()
            except FileNotFoundError as error:
                raise Problem("The recorded pseudonym key version is unavailable.") from error
            if len(secret) != 32:
                raise Problem("The recorded key could not be read.")
            return version, secret


def pseudonym(value, domain: str, scope: str, secret: bytes):
    if value is None:
        return None
    message = canonical(["privforensics-hmac-v1", domain, scope, str(value)]).encode("utf-8")
    return f"{domain}_{hmac.new(secret, message, hashlib.sha256).hexdigest()[:32]}"


def domain_scope(dataset: dict, scope: str) -> str:
    return {"dataset": f"dataset:{dataset['id']}", "case": f"case:{dataset['case_id']}", "workspace": "workspace"}[scope]


def default_rules(dataset: dict) -> dict:
    return {key: "mask" for key in dataset["meta"]["fields"] if key in DOMAINS}


def transform(row: dict, rules: dict, scope: str, secret: bytes | None, *, mask_value=mask) -> dict:
    result = {}
    for key, value in row.items():
        rule = rules.get(key, "keep")
        if rule == "drop":
            continue
        if rule == "mask":
            value = mask_value(value)
        if rule == "hmac":
            value = pseudonym(value, DOMAINS.get(key, key), scope, secret)
        result[key] = value
    return result


class Privacy:
    def __init__(self, db: Database, datasets: Datasets, keys: Keys):
        self.db, self.datasets, self.keys = db, datasets, keys

    def policy(self, dataset: dict) -> dict:
        existing = self.db.one("SELECT rules,scope,updated_at FROM policies WHERE dataset_id=?", (dataset["id"],))
        return decode(existing, "rules") if existing else {
            "rules": default_rules(dataset), "scope": "case", "updated_at": None,
        }

    def validate(self, dataset: dict, rules: dict) -> dict:
        allowed = set(dataset["meta"]["fields"])
        if set(rules) - allowed:
            raise Problem("The policy refers to fields outside the selected dataset.")
        return {key: rules.get(key, "mask" if key in DOMAINS else "keep") for key in allowed}

    def save(self, dataset: dict, rules: dict, scope: str) -> dict:
        rules = self.validate(dataset, rules)
        if "hmac" in rules.values():
            self.keys.read()
        with self.db.connect(write=True) as connection:
            connection.execute(
                """INSERT INTO policies VALUES (?,?,?,?)
                   ON CONFLICT(dataset_id) DO UPDATE SET rules=excluded.rules,scope=excluded.scope,updated_at=excluded.updated_at""",
                (dataset["id"], canonical(rules), scope, utc()),
            )
            record(connection, "policy.saved", dataset["id"], dataset["case_id"],
                   {"scope": scope, "protected_fields": sum(rule != "keep" for rule in rules.values())})
        return self.policy(dataset)

    def preview(self, dataset: dict, rules: dict, scope: str, count: int) -> dict:
        rules = self.validate(dataset, rules)
        version, secret = self.keys.read() if "hmac" in rules.values() else (None, None)
        entries = []
        for record_row in self.datasets.sample(dataset, count):
            values = {key: record_row.get(key) for key in dataset["meta"]["fields"]}
            visible = safe_event(dataset, record_row)["fields"]
            protected = transform(values, rules, domain_scope(dataset, scope), secret)
            for key, value in protected.items():
                rule = rules.get(key)
                if rule == "keep" or key == "synthetic_label":
                    protected[key] = visible[key]
                elif rule == "hmac" and value:
                    protected[key] = f"{value[:17]}…"
            entries.append({"source": source_reference(dataset, record_row), "before": visible, "after": protected})
        return {"rows": entries, "key_version": version, "rules": rules, "scope": scope}

    def inventory(self, dataset: dict, limit=750) -> dict:
        rows = self.datasets.sample(dataset, limit)
        inventory = []
        counts = Counter()
        accounts = Counter()
        for row in rows:
            if row["src_user"]:
                accounts[row["src_user"]] += 1
            quasi = tuple(row.get(key) for key in ("ts", "location", "src_host", "device_id"))
            if sum(value is not None for value in quasi) >= 2:
                counts[quasi] += 1
        policy = self.policy(dataset)
        for key in dataset["meta"]["fields"]:
            sample = []
            types = set()
            total = 0
            direct = False
            for row in rows:
                value = row.get(key)
                if value is None:
                    continue
                hits = detect(str(value))
                if key not in DOMAINS and not hits:
                    continue
                if key in DOMAINS:
                    hits.append(FIELD_TYPES[DOMAINS[key]])
                direct = direct or DOMAINS.get(key) in {"email", "ip", "phone"} or bool(
                    set(hits) & {"Email", "IP address", "Phone"})
                types.update(hits)
                total += 1
                if len(sample) < 3:
                    sample.append({"value": mask(value), "source": source_reference(dataset, row)})
            if total:
                inventory.append({
                    "field": key, "detector": "Structured field + pattern" if key in DOMAINS else "Pattern",
                    "types": sorted(types), "count": total, "risk": "high" if direct else "medium",
                    "recommended": "mask" if direct or key == "location" else "hmac", "samples": sample,
                })
        conditions = [
            ("Direct identifiers", any(item["risk"] == "high" for item in inventory),
             "A structured email, IP or phone field or a matching pattern appears in the sample."),
            ("Linkability", any(count > 1 for count in accounts.values()),
             "An account identifier is repeated across sampled events."),
            ("Re-identification potential", any(count == 1 for count in counts.values()),
             "At least one populated time, device, host or location combination is unique in the sample."),
            ("Attribute inference", any(row.get("location") or row.get("process") for row in rows),
             "A populated location or process attribute can support inference about activity."),
            ("Unnecessary exposure", bool(inventory) and (not policy["updated_at"] or
              any(policy["rules"].get(item["field"], "keep") == "keep" for item in inventory)),
             "Sensitive fields exist and the saved policy is absent or keeps a detected field."),
            ("Membership inference", dataset["kind"] == "synthetic" and bool(rows),
             "This schema supports supervised training where membership separation can be measured."),
            ("Model output leakage", bool(self.db.one("SELECT id FROM runs WHERE dataset_id=? LIMIT 1", (dataset["id"],))),
             "A saved run exposes aggregate scores or source-linked model flags in the local workspace."),
        ]
        return {
            "inventory": inventory, "sample_rows": len(rows), "score": sum(risk for _, risk, _ in conditions),
            "rules": [{"name": name, "triggered": risk, "rule": rule} for name, risk, rule in conditions],
            "scope": "First validated rows in physical source order. The score counts triggered rules.",
        }
