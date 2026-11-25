import time

import pytest
from fastapi.testclient import TestClient

from privforensics.api import create_app
from privforensics.common import Config


@pytest.fixture
def app(tmp_path):
    return create_app(Config(tmp_path / "state", (tmp_path,)))


@pytest.fixture
def client(app):
    with TestClient(app, base_url="http://127.0.0.1") as session:
        yield session


def data(response, code=200):
    assert response.status_code == code, response.text
    return response.json()


def finish(client, response, expected="completed"):
    job = data(response, 202)
    for _ in range(550):
        job = data(client.get("/api/jobs/" + job["id"]))
        if job["status"] not in {"queued", "running"}:
            assert job["status"] == expected, job
            return job["result"] if expected == "completed" else job
        time.sleep(0.02)
    pytest.fail("Background job did not reach a terminal state")


@pytest.fixture
def case(client):
    case = data(client.post("/api/cases", json={"title": "Synthetic fixture case", "description": "Internal case note"}), 201)
    return "/api/cases/" + case["id"]


@pytest.fixture
def demo(client, case):
    finish(client, client.post(case + "/demo"))
    return {record["kind"]: record for record in data(client.get(case + "/datasets"))}
