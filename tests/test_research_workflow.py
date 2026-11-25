import hashlib
import io
from pathlib import Path

import pytest
from pypdf import PdfReader

from conftest import data, finish
from privforensics.experiments import isolate_split
from privforensics.privacy import detect, mask, pseudonym


def test_detectors_and_domain_scopes():
    hits = detect("Reply to sample@example.test or +1 202-555-0113 from 192.0.2.1 U1@DOM1 DEV-42")
    assert set(hits) == {"Email", "Phone", "IP address", "Account identifier", "Device identifier"}
    assert "IP address" in detect("Source 2001:db8::1")
    assert "IP address" not in detect("999.300.500.444")
    assert mask("sample@example.test") != "sample@example.test"
    key = b"\x01" * 32
    first = pseudonym("U7", "account", "case:1", key)
    assert first == pseudonym("U7", "account", "case:1", key)
    assert len({first, pseudonym("U7", "host", "case:1", key), pseudonym("U7", "account", "case:2", key)}) == 3


def test_privacy_profile_policy_reveal_and_export(client, case, demo, tmp_path):
    dataset = demo["synthetic"]
    base = "/api/datasets/" + dataset["id"]
    profile = data(client.get(base + "/privacy"))
    assert profile["sample_rows"] == 750
    assert profile["score"] == sum(rule["triggered"] for rule in profile["rules"])
    assert {"email", "phone", "ip", "src_user", "device_id"}.issubset(row["field"] for row in profile["inventory"])
    data(client.post("/api/keys", json={}))
    assert "secret" not in data(client.get("/api/keys"))
    rules = {"src_user": "hmac", "email": "drop", "ip": "mask"}
    body = {"rules": rules, "scope": "case"}
    saved = data(client.put(base + "/policy", json=body))
    assert saved["rules"]["email"] == "drop"
    one = data(client.post(base + "/policy/preview", json=body))
    two = data(client.post(base + "/policy/preview", json=body))
    assert one == two
    assert one["rows"][0]["after"]["src_user"].startswith("account_")
    assert "email" not in one["rows"][0]["after"]
    assert client.post(base + "/events/2/reveal", json={"field": "email", "confirmed": True},
                       headers={"X-PrivForensics-Presentation": "1"}).status_code == 403
    revealed = data(client.post(base + "/events/2/reveal", json={"field": "email", "confirmed": True}))
    assert revealed["seconds"] == 10
    assert revealed["value"].endswith("@example.test")
    audit = data(client.get("/api/audit?entity=" + dataset["id"]))
    assert revealed["value"] not in str(audit)
    assert client.post(base + "/policy/export", json={"scope": "case", "rules": {"email": "keep"}, "confirm": True},
                       headers={"X-PrivForensics-Presentation": "1"}).status_code == 403
    export = client.post(base + "/policy/export", json={**body, "confirm": True, "count": 12})
    assert export.status_code == 200
    assert len(export.text.splitlines()) == 13
    assert "email" not in export.text.splitlines()[0].split(",")
    assert revealed["value"] not in export.text
    key_path = next((tmp_path / "state" / "keys").glob("*.bin"))
    assert key_path.stat().st_mode & 0o077 == 0
    assert len(key_path.read_bytes()) == 32
    assert client.post("/api/keys", json={"rotate": True}).status_code == 400
    rotated = data(client.post("/api/keys", json={"rotate": True, "confirm": True}))
    assert rotated["version"] != one["key_version"]
    assert data(client.post(base + "/policy/preview", json=body))["rows"][0]["after"]["src_user"] != one["rows"][0]["after"]["src_user"]


def test_disjoint_split():
    source = [{"ts": line * 3, "line": line, "src_user": f"U{line % 25}"} for line in range(1, 501)]
    for split in ("temporal", "group"):
        train, reserve, holdout, label = isolate_split(source, {"seed": 419, "split": split})
        parts = [{row["line"] for row in group} for group in (train, reserve, holdout)]
        assert not (parts[0] & parts[1] or parts[0] & parts[2] or parts[1] & parts[2])
        if split == "group":
            actors = [{row["src_user"] for row in group} for group in (train, reserve, holdout)]
            assert not (actors[0] & actors[1] or actors[0] & actors[2] or actors[1] & actors[2])
        else:
            assert min(parts[2]) > max(parts[0] | parts[1])


@pytest.mark.filterwarnings("ignore:Secure RNG turned off")
@pytest.mark.filterwarnings("ignore:Full backward hook is firing")
def test_models_accounting_aggregate_privacy_and_report(client, case, demo):
    dataset_id = demo["synthetic"]["id"]
    data(client.post("/api/keys", json={}))
    defaults = {"dataset_id": dataset_id, "max_rows": 1500, "trees": 14, "epochs": 3}
    configs = [("E0", "random_forest"), ("E1", "isolation_forest"), ("E2", "random_forest"),
               ("E3", "random_forest"), ("E0", "neural"), ("E4", "dp_neural")]
    runs = []
    for mechanism, model in configs:
        reply = client.post(case + "/runs", json={**defaults, "mechanism": mechanism, "model": model})
        result = finish(client, reply)
        run = data(client.get("/api/runs/" + result["run_id"]))
        assert run["manifest"]["dataset_hash"] == demo["synthetic"]["sha256"]
        assert 0 <= run["results"]["metrics"]["f1"] <= 1
        assert sum(run["results"]["confusion"]) == run["results"]["counts"]["holdout"]
        assert run["results"]["performance"]["training_s"] > 0
        runs.append(run)
    assert runs[0]["results"]["importance"]
    assert runs[0]["results"]["linkage"]["success"] == 1
    assert runs[2]["results"]["linkage"]["success"] == 0
    distribution = data(client.get("/api/datasets/" + dataset_id + "/distribution"))
    assert distribution["field"] == "access"
    assert sum(count for _, count in distribution["items"]) == demo["synthetic"]["rows"]
    trail = data(client.get("/api/datasets/" + dataset_id + "/timeline?include_model=true"))
    assert all("run_id" in flag and flag["event"]["time"] is not None for flag in trail["predictions"])
    assert runs[1]["results"]["membership"] is None
    assert runs[0]["results"]["membership"]["members"] == runs[0]["results"]["membership"]["nonmembers"]
    dp = runs[-1]["results"]["dp"]
    assert dp["epsilon"] > 0 and dp["delta"] == 1e-5 and dp["steps"] > 0 and dp["accountant"] == "Opacus RDP"
    assert client.post(case + "/runs", json={**defaults, "mechanism": "E4", "model": "random_forest"}).status_code == 400
    assert client.post(case + "/runs", json={**defaults, "dataset_id": demo["auth"]["id"]}).status_code == 400
    unlabelled = finish(client, client.post(case + "/runs", json={
        **defaults, "dataset_id": demo["auth"]["id"], "model": "isolation_forest",
    }))
    assert data(client.get("/api/runs/" + unlabelled["run_id"]))["results"]["metrics"] == {}
    data(client.post("/api/keys", json={"rotate": True, "confirm": True}))
    retry = finish(client, client.post("/api/runs/" + runs[2]["id"] + "/rerun"))
    replay = data(client.get("/api/runs/" + retry["run_id"]))
    assert replay["manifest"]["config_hash"] == runs[2]["manifest"]["config_hash"]
    assert replay["results"]["metrics"] == runs[2]["results"]["metrics"]
    link = data(client.post("/api/datasets/" + dataset_id + "/linkage", json={}))
    assert [row["mechanism"] for row in link["results"]] == ["Original", "Masked", "HMAC pseudonymized"]
    assert link["results"][0]["success"] > link["results"][2]["success"]
    assert link["results"][2]["linkability"] > 0
    assert client.post("/api/datasets/" + demo["auth"]["id"] + "/linkage", json={}).status_code == 400
    run_ids = [runs[0]["id"], runs[-1]["id"]]
    for format in ("pdf", "csv", "html", "md"):
        created = data(client.post(case + "/reports", json={"type": "evaluation", "format": format,
                                                          "confirmed": True, "run_ids": run_ids}), 201)
        download = client.get("/api/reports/" + created["id"] + "/download")
        assert hashlib.sha256(download.content).hexdigest() == created["sha256"]
        if format == "pdf":
            rendered = PdfReader(io.BytesIO(download.content))
            text = " ".join(page.extract_text() for page in rendered.pages)
            assert "Differential privacy accounting" in text and "Opacus RDP" in text
        else:
            assert b"Opacus RDP" in download.content
        assert b"Internal case note" not in download.content

@pytest.mark.filterwarnings("ignore:Secure RNG turned off")
@pytest.mark.filterwarnings("ignore:Full backward hook is firing")
def test_target_epsilon_uses_the_accountant(client, case, demo):
    target = 3.5
    created = finish(client, client.post(case + "/runs", json={
        "dataset_id": demo["synthetic"]["id"], "model": "dp_neural", "mechanism": "E4",
        "max_rows": 1200, "epochs": 2, "target_epsilon": target,
    }))
    run = data(client.get("/api/runs/" + created["run_id"]))
    measured = run["results"]["dp"]
    assert 0 < measured["epsilon"] <= target
    assert measured["noise"] > 0
    assert run["config"]["target_epsilon"] == target
