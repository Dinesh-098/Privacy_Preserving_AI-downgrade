from .common import Problem, ident, utc
from .db import Database, record

CASE_SELECT = """SELECT c.*,
    (SELECT COUNT(*) FROM evidence WHERE case_id=c.id) AS evidence_count,
    (SELECT COUNT(*) FROM datasets WHERE case_id=c.id) AS dataset_count,
    (SELECT COUNT(*) FROM findings WHERE case_id=c.id) AS finding_count,
    (SELECT COUNT(*) FROM runs WHERE case_id=c.id) AS run_count,
    (SELECT COUNT(*) FROM reports WHERE case_id=c.id) AS report_count,
    (SELECT COUNT(*) FROM evidence WHERE case_id=c.id AND integrity='verified') AS verified_count,
    (SELECT COUNT(*) FROM evidence WHERE case_id=c.id AND integrity='mismatch') AS mismatch_count,
    (SELECT COUNT(*) FROM policies p JOIN datasets d ON d.id=p.dataset_id WHERE d.case_id=c.id) AS policy_count
    FROM cases c"""


class Cases:
    def __init__(self, db: Database):
        self.db = db

    def get(self, case_id: str) -> dict:
        return self.db.one(f"{CASE_SELECT} WHERE c.id=?", (case_id,), missing="Investigation not found.")

    def list(self, search="", status=None, page=1, size=30) -> dict:
        query = f"%{search.lower()}%"
        where = "WHERE (lower(c.title) LIKE ? OR lower(c.id) LIKE ?) AND (? IS NULL OR c.status=?)"
        args = (query, query, status, status)
        return {
            "items": self.db.rows(f"{CASE_SELECT} {where} ORDER BY c.updated_at DESC,c.rowid DESC LIMIT ? OFFSET ?",
                                  (*args, size, (page - 1) * size)),
            "total": self.db.one(f"SELECT count(*) AS n FROM cases c {where}", args)["n"],
        }

    def create(self, title: str, description: str) -> dict:
        title = title.strip()
        if not title:
            raise Problem("Enter an investigation title.")
        case_id, now = ident("CASE"), utc()
        with self.db.connect(write=True) as connection:
            connection.execute("INSERT INTO cases VALUES (?,?,?,'open',?,?)",
                               (case_id, title, description.strip(), now, now))
            record(connection, "case.created", case_id, case_id, {})
        return self.get(case_id)

    def update(self, case_id: str, *, title: str, description: str, status: str) -> dict:
        original = self.get(case_id)
        if not title.strip():
            raise Problem("Enter an investigation title.")
        with self.db.connect(write=True) as connection:
            connection.execute("UPDATE cases SET title=?,description=?,status=? WHERE id=?",
                               (title.strip(), description.strip(), status, case_id))
            record(connection, "case.updated", case_id, case_id, {"from": original["status"], "to": status})
        return self.get(case_id)
