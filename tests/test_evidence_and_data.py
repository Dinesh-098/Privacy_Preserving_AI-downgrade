import gzip
import hashlib
import sqlite3
from pathlib import Path

import pyarrow.parquet as pq

from privforensics.data import MAX_LINE
from conftest import data, finish


def test_evidence_hash_mismatch_and_audit(client, case, tmp_path):
    source = tmp_path / "auth.log"
    original = b"1,U1@DOM1,U1@DOM1,C1,C2,Kerberos,Network,LogOn,Success\n"
    source.write_bytes(original)
    evidence = finish(client, client.post(case + "/evidence/local", json={"path": str(source)}))
    assert evidence["sha256"] == hashlib.sha256(original).hexdigest()
    assert evidence["integrity"] == "registered"
    source_path = "/api/evidence/" + evidence["id"]
    assert finish(client, client.post(source_path + "/verify"))["integrity"] == "verified"
    source.write_bytes(original + b"changes\n")
    missed = finish(client, client.post(source_path + "/verify"))
    assert missed["integrity"] == "mismatch"
    assert missed["sha256"] != missed["verified_sha256"]
    assert finish(client, client.post(source_path + "/ingest", json={"kind": "auth"}), "failed")["error"].startswith(
        "The evidence changed")
    export = data(client.get(source_path + "/export"))
    assert {entry["action"] for entry in export["custody"]} >= {"evidence.registered", "evidence.verified", "evidence.mismatch"}
    assert "path" not in export["evidence"]
    assert data(client.get("/api/audit/verify"))["valid"]
    with sqlite3.connect(tmp_path / "state" / "privforensics.sqlite3") as connection:
        connection.execute("UPDATE audit SET detail='{}' WHERE action='evidence.verified'")
    assert not data(client.get("/api/audit/verify"))["valid"]


def test_origin_and_evidence_paths(client, case, tmp_path):
    assert client.get("/api/health", headers={"Host": "attacker.test"}).status_code == 400
    assert client.post(case + "/demo", headers={"Origin": "https://site.example"}).status_code == 403
    assert client.get("/api/health", headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403
    assert client.post(case + "/evidence/local", json={"path": "../source"}).status_code == 400
    assert client.post(case + "/evidence/local", json={"path": "/etc/hosts"}).status_code == 400
    hidden = tmp_path / "state" / "outside-source.csv"
    hidden.write_bytes(b"test")
    assert client.post(case + "/evidence/local", json={"path": str(hidden)}).status_code == 400
    outside = tmp_path / "escapes.txt"
    outside.symlink_to("/etc/hosts")
    assert client.post(case + "/evidence/local", json={"path": str(outside)}).status_code == 400
    valid = client.get("/api/health")
    assert valid.headers["Cache-Control"] == "no-store"
    assert valid.headers["X-Frame-Options"] == "DENY"


def test_streamed_gzip_ranges_chunks_and_validation(client, case, tmp_path, monkeypatch):
    monkeypatch.setattr("privforensics.data.CHUNK_ROWS", 2)
    original = tmp_path / "auth.txt.gz"
    def row(second):
        return f"{second},U1@DOM1,?,C1,C2,Kerberos,Network,LogOn,Fail\n".encode()
    with gzip.open(original, "wb") as output:
        output.writelines([row(1), b"oversized," + b"a" * (MAX_LINE + 1) + b"\n", row(3), b"\xff\n", row(5), row(6), row(7)])
    registered = finish(client, client.post(case + "/evidence/local", json={"path": str(original)}))
    pathname = "/api/evidence/" + registered["id"] + "/ingest"
    first = finish(client, client.post(pathname, json={"kind": "auth", "mode": "range", "start": 2, "count": 5}))
    assert (first["first_line"], first["last_line"], first["rows"], first["malformed"]) == (2, 6, 3, 2)
    assert first["meta"]["error_examples"][0]["line"] == 2
    file = pq.ParquetFile(tmp_path / "state" / "parquet" / f"{first['id']}.parquet")
    assert file.num_row_groups == 2
    events = data(client.get("/api/datasets/" + first["id"] + "/events?size=2"))
    assert [event["line"] for event in events["items"]] == [3, 5]
    assert events["has_more"]
    assert events["items"][0]["fields"]["dst_user"] is None
    assert events["items"][0]["label_status"] == "Unlabelled"
    second = finish(client, client.post(pathname, json={"kind": "auth", "mode": "range", "start": 7, "count": 1}))
    assert second["rows"] == 1
    assert data(client.get("/api/datasets/" + second["id"] + "/events"))["items"][0]["source"]["line"] == 7
    repeat = finish(client, client.post(pathname, json={"kind": "auth", "mode": "range", "start": 7, "count": 1}))
    assert repeat["id"] == second["id"]
    assert client.post(pathname, json={"kind": "auth", "mode": "full"}).status_code == 400
    assert original.exists()


def test_old_synthetic_layout_preserves_label_and_missing_time(client, case):
    contents = ("User_ID,Email,IP_Address,Login_Hour,Failed_Attempts,Access_Type,Device_Type,Location,Status\n"
                "U001,fixture@example.test,192.0.2.1,2,1,Remote,Laptop,Campus,Suspicious\n")
    evidence = finish(client, client.post(case + "/evidence/upload", files={"file": ("legacy.csv", contents)}))
    dataset = finish(client, client.post("/api/evidence/" + evidence["id"] + "/ingest", json={"kind": "synthetic"}))
    event = data(client.get("/api/datasets/" + dataset["id"] + "/events/2"))
    assert event["time"] is None
    assert event["fields"]["synthetic_label"] == "Suspicious"
    assert event["source"]["origin"] == "synthetic"
    assert "fixture@example.test" not in str(event)


def test_explainable_correlation_and_finding(client, case, demo):
    redteam = demo["redteam"]
    related = data(client.get("/api/datasets/" + redteam["id"] + "/events/1/related?window=30"))
    assert related["event"]["label_status"] == "Fixture reference"
    assert {(hit["rule"]["id"], hit["event"]["kind"]) for hit in related["related"]} >= {("R1", "auth"), ("R2", "proc")}
    chosen = related["related"][0]["event"]
    saved = data(client.post(case + "/findings", json={
        "dataset_id": redteam["id"], "line": 1, "window": 30, "title": "Reference confirmation",
        "references": [{"dataset_id": chosen["source"]["dataset_id"], "line": chosen["line"]}],
    }), 201)
    assert saved["events"]["related"][0]["rule"]["id"] == "R1"
    assert saved["events"]["anchor"]["source"]["dataset_hash"] == redteam["sha256"]
    assert client.post(case + "/findings", json={
        "dataset_id": redteam["id"], "line": 1, "title": "Bad reference",
        "references": [{"dataset_id": demo["synthetic"]["id"], "line": 2}],
    }).status_code == 400
