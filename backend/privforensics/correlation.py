from __future__ import annotations

from .common import Problem, canonical, decode, ident, utc
from .data import as_dicts, make_filters
from .db import record
from .privacy import redact_text, safe_event

LANES = ("auth", "proc", "redteam")


def related_rule(left_kind, left, right_kind, right):
    delta = abs(left["ts"] - right["ts"])
    if {left_kind, right_kind} == {"auth", "redteam"} and delta == 0:
        identifiers = ("src_user", "src_host", "dst_host")
        if all(left[key] and left[key] == right[key] for key in identifiers):
            return {"id": "R1", "type": "Red-team reference", "why": "Exact time, source account and ordered host pair.",
                    "seconds": delta}
    if left_kind == right_kind == "synthetic":
        if left["src_user"] and left["src_user"] == right["src_user"]:
            return {"id": "R3", "type": "Temporal association", "why": "Same synthetic account inside the time window.",
                    "seconds": delta}
        return None

    def identities(kind, row):
        pairs = [(row["src_user"], row["src_host"])]
        if kind == "auth":
            pairs.append((row["dst_user"], row["dst_host"]))
        if kind == "redteam":
            pairs.append((row["src_user"], row["dst_host"]))
        return {pair for pair in pairs if all(pair)}

    if identities(left_kind, left) & identities(right_kind, right):
        return {"id": "R2", "type": "Exact identifier association",
                "why": "Same role-paired account and host inside the time window.", "seconds": delta}
    return None


class Correlation:
    def __init__(self, datasets, db):
        self.datasets, self.db = datasets, db

    def timeline(self, case_id, anchor, filters, limit=600) -> dict:
        available = self.compatible(case_id, anchor)
        conditions, args = make_filters(filters)
        rows = []
        groups = ("synthetic",) if anchor["kind"] == "synthetic" else LANES
        with self.datasets.query() as connection:
            for kind in groups:
                group = [item for item in available if item["kind"] == kind]
                if group:
                    rows.extend(self.window(connection, group, conditions, args, limit // len(groups) + 1))
        result = [(dataset, row) for dataset, row in rows if row["ts"] is not None]
        result.sort(key=lambda pair: (pair[1]["ts"], pair[1]["line"]))
        return {"events": [safe_event(dataset, row) for dataset, row in result[:limit]],
                "cap": limit, "scope": [item["id"] for item in available], "clock": anchor["meta"]["clock"],
                "truncated": len(result) >= limit or len(available) > 32}

    def compatible(self, case_id, anchor):
        options = self.datasets.list(case_id)
        return [item for item in options
                if item["meta"]["clock"] == anchor["meta"]["clock"] and
                (anchor["kind"] != "synthetic" or item["id"] == anchor["id"])]

    def window(self, connection, group, conditions, args, limit):
        # Query the latest registered source slices within the declared case and clock.
        by_path = {str(self.datasets.parquet(item["id"])): item for item in group[:32]}
        where = " AND ".join(["ts IS NOT NULL", *conditions])
        sql = f"""SELECT * FROM read_parquet(?,filename=true) WHERE {where}
                   ORDER BY ts,line,filename LIMIT ?"""
        rows = as_dicts(connection.execute(sql, [list(by_path), *args, limit]))
        seen = set()
        unique = []
        for row in rows:
            dataset = by_path[row.pop("filename")]
            key = dataset["evidence_id"], row["line"]
            if key not in seen:
                seen.add(key)
                unique.append((dataset, row))
        return unique

    def related(self, anchor, line, window):
        source = self.datasets.event(anchor, line)
        if source["ts"] is None:
            return {"event": safe_event(anchor, source), "related": [], "window": window, "truncated": False}
        users = list(dict.fromkeys(value for value in (source["src_user"], source["dst_user"]) if value))
        if not users:
            return {"event": safe_event(anchor, source), "related": [], "window": window, "truncated": False}
        marks = ",".join("?" for _ in users)
        conditions = ["ts BETWEEN ? AND ?", f"(src_user IN ({marks}) OR dst_user IN ({marks}))"]
        args = [max(1, source["ts"] - window), min(2**63 - 1, source["ts"] + window), *users, *users]
        groups = self.compatible(anchor["case_id"], anchor)
        matches = []
        with self.datasets.query() as connection:
            candidates = self.window(connection, groups, conditions, args, 1200)
        for dataset, row in candidates:
            if (dataset["evidence_id"], row["line"]) == (anchor["evidence_id"], line):
                continue
            rule = related_rule(anchor["kind"], source, dataset["kind"], row)
            if rule:
                matches.append({"event": safe_event(dataset, row), "rule": rule})
        matches.sort(key=lambda item: (item["rule"]["id"] != "R1", item["rule"]["seconds"], item["event"]["line"]))
        return {"event": safe_event(anchor, source), "related": matches[:75], "window": window,
                "truncated": len(candidates) >= 1200 or len(groups) > 32 or len(matches) > 75}

    def find(self, dataset, line, window, title, severity, notes, references):
        result = self.related(dataset, line, window)
        available = {(match["event"]["source"]["dataset_id"], match["event"]["line"]): match
                     for match in result["related"]}
        if any((source["dataset_id"], source["line"]) not in available for source in references):
            raise Problem("One or more selected events are outside the current supported correlation.")
        attached = [available[(source["dataset_id"], source["line"])] for source in references]
        finding = ident("FIND")
        event = {"anchor": result["event"], "related": attached, "window": window}
        with self.db.connect(write=True) as connection:
            connection.execute("INSERT INTO findings VALUES (?,?,?,?,?,?,?)",
                               (finding, dataset["case_id"], redact_text(title.strip()), severity,
                                redact_text(notes.strip()), canonical(event), utc()))
            record(connection, "finding.saved", finding, dataset["case_id"], {"source": {key: value for key, value in result["event"]["source"].items() if key != "name"}})
        return decode(self.db.one("SELECT * FROM findings WHERE id=?", (finding,)), "events")
