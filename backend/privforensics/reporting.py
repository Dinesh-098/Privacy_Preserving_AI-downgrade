from __future__ import annotations

import csv
import hashlib
import html
import io
import os
from pathlib import Path

from .common import Problem, canonical, decode, ident, utc
from .db import record
from .privacy import redact_text

TITLES = {
    "investigation": "Investigation summary", "evidence": "Evidence integrity", "correlation": "Event correlation",
    "privacy": "Privacy assessment", "evaluation": "Privacy–utility evaluation", "leakage": "Privacy leakage evaluation",
    "performance": "Computational performance", "audit": "Audit history",
}
FORMATS = {
    "pdf": "application/pdf", "csv": "text/csv", "html": "text/html", "md": "text/markdown",
}


def csv_piece(values) -> str:
    def escape(value):
        return "'" + value if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")) else value
    output = io.StringIO()
    csv.writer(output).writerow([escape(value) for value in values])
    return output.getvalue()


def section(title, columns=(), rows=(), text=None):
    return {"title": title, "columns": list(columns), "rows": list(rows), "text": text}


def metric(value, digits=4):
    return round(value, digits) if value is not None else None


class Reports:
    def __init__(self, config, db, cases, evidence, datasets, experiments, privacy):
        self.config, self.db, self.cases, self.evidence = config, db, cases, evidence
        self.datasets, self.experiments, self.privacy = datasets, experiments, privacy

    def preview(self, case_id, kind, run_ids, sections, include_sensitive):
        case = self.cases.get(case_id)
        sources = self.evidence.list(case_id)
        data = self.datasets.list(case_id)
        runs = [self.experiments.get(run_id) for run_id in run_ids] if run_ids else self.experiments.list(case_id)[:12]
        if any(run["case_id"] != case_id for run in runs):
            raise Problem("Only experiments from this investigation can be included.")
        result = []
        if kind == "investigation":
            result.append(section("Case record", ["Field", "Value"], [
                ["Case", case["id"]], ["Status", case["status"]], ["Created (UTC)", case["created_at"]],
                ["Evidence registered", case["evidence_count"]], ["Datasets ingested", case["dataset_count"]],
                ["Saved findings", case["finding_count"]], ["Completed experiments", case["run_count"]],
            ], case["description"] if include_sensitive else "Case descriptions and investigator notes are hidden."))
        if kind in {"investigation", "evidence"}:
            result.append(section("Evidence register", ["Evidence", "Source", "Bytes", "Integrity", "Registered SHA-256"],
                                  [(f"{row['id']} {row['name']}" if include_sensitive else row["id"],
                                    row["source"], row["size"], row["integrity"], row["sha256"]) for row in sources]))
            if kind == "evidence":
                result.append(section("Recorded verifications", ["Evidence", "Last checked (UTC)", "Recomputed SHA-256"],
                                      [(row["id"], row["verified_at"], row["verified_sha256"]) for row in sources if row["verified_at"]],
                                      "Integrity is a comparison against the registered bytes. The audit history records this application's handling."))
        if kind in {"investigation", "correlation"}:
            findings = [decode(row, "events") for row in self.db.rows(
                "SELECT * FROM findings WHERE case_id=? ORDER BY rowid DESC LIMIT 100", (case_id,))]
            items, associations = [], []
            for finding in findings:
                anchor = finding["events"]["anchor"]["source"]
                items.append([finding["id"], finding["title"] if include_sensitive else finding["severity"], anchor["dataset_id"],
                              anchor["line"], finding["created_at"], finding["notes"] if include_sensitive else None])
                for match in finding["events"]["related"]:
                    source = match["event"]["source"]
                    rule = match["rule"]
                    associations.append([finding["id"], source["dataset_id"], source["line"], rule["id"],
                                         rule["seconds"], rule["why"]])
            result.append(section("Saved findings", ["Finding", "Title" if include_sensitive else "Severity", "Dataset",
                                                    "Line", "Recorded (UTC)", "Notes"], items))
            if associations:
                result.append(section("Documented correlations", ["Finding", "Dataset", "Line", "Rule", "Offset (s)", "Criterion"],
                                      associations, "R1 refers to an exact red-team reference. R2 and R3 describe observed associations."))
        if kind in {"investigation", "privacy"}:
            result.append(section("Dataset provenance", ["Dataset", "Schema", "Origin", "Rows", "Rejected", "Dataset hash"],
                                  [(row["id"], row["kind"], row["origin"], row["rows"], row["malformed"], row["sha256"]) for row in data]))
        if kind == "privacy":
            result.append(section("Saved privacy policies", ["Dataset", "Mask", "HMAC", "Drop", "Scope"],
                                  [(row["id"], *(list(policy["rules"].values()).count(rule) for rule in ("mask", "hmac", "drop")),
                                    policy["scope"]) for row in data if (policy := self.privacy.policy(row))["updated_at"]],
                                  "HMAC pseudonyms preserve equality within the chosen scope. Indirect identifying patterns may remain."))
            checks = []
            for row in data[:6]:
                profile = self.privacy.inventory(row)
                checks.extend([[row["id"], rule["name"], "Triggered" if rule["triggered"] else "Clear", rule["rule"]]
                               for rule in profile["rules"]])
            result.append(section("Heuristic risk rules", ["Dataset", "Category", "Result", "Rule"], checks,
                                  "Each assessment uses up to 750 validated records in physical order, across up to six datasets."))
        if kind in {"investigation", "evaluation", "leakage", "performance"}:
            result.append(section("Run provenance", ["Run", "Dataset", "Origin", "Model", "Config", "Seed", "Holdout n"],
                                  [(run["id"], run["dataset_id"], run["manifest"]["origin"], run["config"]["model"],
                                    run["config"]["mechanism"], run["config"]["seed"], run["results"]["counts"]["holdout"]) for run in runs]))
        if kind == "evaluation":
            metrics = ("accuracy", "precision", "recall", "f1", "roc_auc", "pr_auc", "fpr", "fnr")
            result.append(section("Detection utility", ["Run", *[name.upper() for name in metrics]],
                                  [[run["id"], *[metric(run["results"]["metrics"].get(key)) for key in metrics]] for run in runs],
                                  "Classification metrics use held-out synthetic labels. PR-AUC is measured as average precision."))
            dp_rows = []
            for run in runs:
                if dp := run["results"]["dp"]:
                    dp_rows.append([run["id"], metric(dp["epsilon"]), f"{dp['delta']:.2g}", dp["accountant"],
                                    metric(dp["noise"]), metric(dp["clip"]), metric(dp["sampling_rate"]), dp["steps"]])
            result.append(section("Differential privacy accounting", ["Run", "Epsilon", "Delta", "Accountant", "Noise",
                                      "Clip", "Sampling rate", "Steps"], dp_rows,
                                  "The recorded accountant concerns row-level training under the stated Poisson and noise assumptions."))
        if kind in {"evaluation", "leakage"}:
            result.append(section("Membership separation", ["Run", "Members", "Nonmembers", "Accuracy", "ROC-AUC", "Advantage"],
                                  [[run["id"], leak["members"], leak["nonmembers"], metric(leak["accuracy"]),
                                    metric(leak["auc"]), metric(leak["advantage"])]
                                   for run in runs if (leak := run["results"]["membership"])],
                                  "Aggregate results use the generated fixture, class-matched samples and separate calibration rows."))
        if kind == "leakage":
            built_in = next((row for row in data if row["kind"] == "synthetic" and row["origin"] == "fixture"), None)
            if built_in:
                linkage = self.experiments.linkage(built_in, [])
                result.append(section("Synthetic linkage", ["View", "Unique correct matches", "Release n", "Linkability"],
                                      [[entry["mechanism"], entry["matches"], entry["possible"], metric(entry["linkability"])]
                                       for entry in linkage["results"]], linkage["assumptions"]))
        if kind in {"evaluation", "performance"}:
            result.append(section("Model overhead", ["Run", "Train s", "Inference s", "Peak RSS MiB", "CPU % of one core", "Rows/s"],
                                  [[run["id"], *[metric(run["results"]["performance"].get(key)) for key in
                                   ("training_s", "inference_s", "peak_rss_mb", "cpu_percent", "inference_rows_per_s")]] for run in runs],
                                  "RSS and CPU are process-wide measurements. CPU can exceed 100% with multiple cores."))
            if kind == "performance":
                result.append(section("Ingestion performance", ["Dataset", "Valid rows", "Read MB/s", "Rows/s", "Seconds"],
                                      [[item["id"], item["rows"], *[metric(item["meta"][key]) for key in
                                        ("mb_per_s", "rows_per_s", "duration_s")]] for item in data]))
        if kind == "audit":
            rows = self.db.rows("SELECT * FROM audit WHERE case_id=? ORDER BY sequence DESC LIMIT 250", (case_id,))
            result.append(section("Application audit entries", ["Sequence", "UTC time", "Actor", "Action", "Reference", "Entry hash"],
                                  [[row[key] for key in ("sequence", "time", "actor", "action", "entity", "entry_hash")] for row in rows],
                                  "This report includes the latest 250 events for the selected investigation. Audit History can export the full filtered ledger."))
        if sections:
            allowed = {entry["title"] for entry in result}
            if set(sections) - allowed:
                raise Problem("One or more requested sections are unavailable for this report.")
            result = [entry for entry in result if entry["title"] in sections]
        return {"title": TITLES[kind], "subtitle": case["title"] if include_sensitive else case_id,
                "generated_at": utc(), "case_id": case_id, "sections": result,
                "redaction": "Case labels and notes included. Evidence record values are redacted." if include_sensitive else
                "Case names, file names, free-text notes and evidence record values are omitted."}

    def path(self, report_id: str, format: str) -> Path:
        return self.config.root / "reports" / f"{report_id}.{format}"

    def generate(self, case_id, kind, format, report):
        report_id = ident("REP")
        path = self.path(report_id, format)
        content = render(report, format)
        partial = path.with_suffix(".partial")
        try:
            fd = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as output:
                output.write(content)
            partial.replace(path)
            checksum = hashlib.sha256(content).hexdigest()
            try:
                with self.db.connect(write=True) as connection:
                    connection.execute("INSERT INTO reports VALUES (?,?,?,?,?,?,?)",
                                       (report_id, case_id, kind, format, checksum, len(content), utc()))
                    record(connection, "report.generated", report_id, case_id,
                           {"type": kind, "format": format, "sha256": checksum})
            except BaseException:
                path.unlink(missing_ok=True)
                raise
        finally:
            partial.unlink(missing_ok=True)
        return self.get(report_id)

    def get(self, report_id):
        return self.db.one("SELECT * FROM reports WHERE id=?", (report_id,), missing="Report not found.")

    def list(self, case_id):
        self.cases.get(case_id)
        return self.db.rows("SELECT * FROM reports WHERE case_id=? ORDER BY rowid DESC LIMIT 150", (case_id,))


def render(data, format):
    def clean(value):
        return str(value) if value is not None else "—"
    if format == "pdf":
        from reportlab.lib import colors
        from reportlab.lib.enums import TA_LEFT
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import mm
        from reportlab.platypus import LongTable, Paragraph, SimpleDocTemplate, Spacer, TableStyle

        output = io.BytesIO()
        styles = getSampleStyleSheet()
        styles.add(ParagraphStyle("Cell", fontName="Helvetica", fontSize=7.5, leading=10, splitLongWords=True,
                                  textColor=colors.HexColor("#172a40"), alignment=TA_LEFT))
        styles.add(ParagraphStyle("HeaderCell", parent=styles["Cell"], fontName="Helvetica-Bold",
                                  textColor=colors.white))
        document = SimpleDocTemplate(output, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm,
                                     topMargin=16 * mm, bottomMargin=18 * mm, title=data["title"],
                                     author="PrivForensics")
        text = lambda value, name="Normal": Paragraph(html.escape(clean(value)), styles[name])
        story = [text("PRIVFORENSICS", "Heading3"), text(data["title"], "Title"), text(data["subtitle"], "Heading2"),
                 text(data["generated_at"] + " · " + data["redaction"]), Spacer(1, 8)]
        for item in data["sections"]:
            story.append(text(item["title"], "Heading2"))
            if item["text"]:
                story.append(text(item["text"]))
                story.append(Spacer(1, 5))
            if item["columns"] and item["rows"]:
                values = [[text(value, "HeaderCell") for value in item["columns"]]] + [
                    [text(value, "Cell") for value in row] for row in item["rows"]]
                table = LongTable(values, colWidths=[document.width / len(item["columns"])] * len(item["columns"]),
                                  repeatRows=1, splitInRow=1)
                table.setStyle(TableStyle([
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#263d53")),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f0f4f7")]),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                    ("LINEBELOW", (0, -1), (-1, -1), 0.35, colors.HexColor("#bac7d2")),
                ]))
                story.extend([table, Spacer(1, 6)])
            elif item["columns"]:
                story.append(text("No records in this scope."))
        def footer(canvas, doc):
            canvas.setFont("Helvetica", 8)
            canvas.setFillColor(colors.HexColor("#465d73"))
            canvas.drawString(15 * mm, 11 * mm, f"PrivForensics  /  {data['case_id']}")
            canvas.drawRightString(A4[0] - 15 * mm, 11 * mm, str(doc.page))
        document.build(story, onFirstPage=footer, onLaterPages=footer)
        return output.getvalue()
    if format == "csv":
        lines = [csv_piece([data["title"], data["case_id"], data["generated_at"]]), csv_piece([data["redaction"]])]
        for item in data["sections"]:
            lines.append(csv_piece([item["title"]]))
            if item["text"]:
                lines.append(csv_piece([item["text"]]))
            if item["columns"]:
                lines.append(csv_piece(item["columns"]))
                lines.extend(csv_piece(row) for row in item["rows"])
            lines.append("\n")
        return "".join(lines).encode("utf-8")
    if format == "html":
        escape = lambda value: html.escape(clean(value))
        body = ["<!doctype html><html lang='en'><meta charset='utf-8'><title>", escape(data["title"]),
                "</title><style>body{font:15px system-ui;max-width:1100px;margin:40px auto;padding:0 18px;color:#172a40}",
                "th,td{padding:7px;text-align:left;border-bottom:1px solid #ccd5df;overflow-wrap:anywhere}",
                "table{width:100%;border-collapse:collapse;table-layout:fixed}th{background:#edf3f8}</style><main>",
                "<h1>", escape(data["title"]), "</h1><p>", escape(data["subtitle"]), " · ", escape(data["generated_at"]),
                "</p><p>", escape(data["redaction"]), "</p>"]
        for item in data["sections"]:
            body += ["<h2>", escape(item["title"]), "</h2>"]
            if item["text"]:
                body += ["<p>", escape(item["text"]), "</p>"]
            if item["columns"] and item["rows"]:
                body += ["<table><thead><tr>", *[f"<th scope='col'>{escape(value)}</th>" for value in item["columns"]],
                         "</tr></thead><tbody>"]
                body.extend("<tr>" + "".join(f"<td>{escape(value)}</td>" for value in row) + "</tr>" for row in item["rows"])
                body.append("</tbody></table>")
            elif item["columns"]:
                body.append("<p>No records in this scope.</p>")
        body.append("</main></html>")
        return "".join(body).encode("utf-8")
    lines = [f"# {data['title']}", "", clean(data["subtitle"]), "", data["generated_at"], "", data["redaction"], ""]
    def cell(value):
        return html.escape(clean(value)).replace("|", r"\|").replace("\n", " ")
    for item in data["sections"]:
        lines.extend([f"## {item['title']}", ""])
        if item["text"]:
            lines.extend([html.escape(item["text"]), ""])
        if item["columns"] and item["rows"]:
            lines.append("| " + " | ".join(map(cell, item["columns"])) + " |")
            lines.append("| " + " | ".join(["---"] * len(item["columns"])) + " |")
            lines.extend("| " + " | ".join(map(cell, row)) + " |" for row in item["rows"])
        elif item["columns"]:
            lines.append("No records in this scope.")
        lines.append("")
    return "\n".join(lines).encode("utf-8")
