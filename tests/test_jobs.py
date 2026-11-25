from threading import Event
from time import sleep

from conftest import data


def test_active_duplicate_and_cooperative_cancellation(app, client, case):
    started, release = Event(), Event()
    case_id = case.rsplit("/", 1)[1]
    jobs = app.state.jobs
    def operation(context):
        started.set()
        release.wait(4)
        context.check()
        return {"unexpected": True}
    job = jobs.submit(case_id, "test", "Bounded operation", "identical data", operation)
    try:
        assert started.wait(2)
        duplicate = jobs.submit(case_id, "test", "Bounded operation", "identical data", operation)
        assert duplicate["id"] == job["id"]
        response = client.post("/api/jobs/" + job["id"] + "/cancel")
        assert data(response)["cancel_requested"] is True
        release.set()
        for _ in range(100):
            state = jobs.get(job["id"])
            if state["status"] == "cancelled":
                break
            sleep(.01)
        assert state["status"] == "cancelled"
        assert state["result"] is None
    finally:
        release.set()
