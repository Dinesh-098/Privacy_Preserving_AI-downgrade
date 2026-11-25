from pathlib import Path
from tempfile import TemporaryDirectory

from dataset.generate_dataset import VERSION, generate, make_lanl_shaped

from .common import Config, ident


def load_demo(config: Config, evidence, datasets, case_id, context) -> dict:
    target = config.root / "fixtures" / VERSION
    if not target.is_dir():
        with TemporaryDirectory(prefix="fixtures-", dir=config.root / "fixtures") as directory:
            staging = Path(directory) / ident("BUILD")
            staging.mkdir(mode=0o700)
            generate(staging / "forensic_auth_logs.csv")
            make_lanl_shaped(staging)
            staging.rename(target)
    files = [(target / "forensic_auth_logs.csv", "synthetic", 2)] + [
        (target / f"fixture-{kind}.txt.gz", kind, 1) for kind in ("auth", "proc", "redteam")
    ]
    created = []
    for path, kind, first in files:
        context.check()
        registered = evidence.register(case_id, path, path.name, "fixture", context)
        result = datasets.ingest(registered["id"], kind, first, None, context)
        created.append(result["id"])
    return {"case_id": case_id, "datasets": created}
