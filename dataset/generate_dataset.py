"""Generate an explicitly synthetic, reproducible authentication experiment dataset."""

import argparse
import csv
import gzip
import random
from pathlib import Path

VERSION = "synthetic-auth-v1"
FIELDS = (
    "User_ID", "Email", "IP_Address", "Login_Hour", "Failed_Attempts", "Access_Type", "Device_Type",
    "Location", "Status", "Elapsed_Seconds", "Device_ID", "Phone",
)


def generate(path: Path, count: int = 10_000, seed: int = 419) -> None:
    rng = random.Random(seed)
    labels = [1] * round(count * 0.378) + [0] * (count - round(count * 0.378))
    rng.shuffle(labels)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow(FIELDS)
        for index, flagged in enumerate(labels):
            user = rng.randrange(1, 241)
            device = (user * 3 + rng.randrange(1, 5)) % 280 + 1
            night = rng.random() < (0.54 if flagged else 0.24)
            hour = rng.choice((0, 1, 2, 3, 4, 5, 22, 23)) if night else rng.randrange(6, 22)
            attempts = min(15, int(rng.expovariate(0.36 if flagged else 0.9)))
            connection = rng.choices(("Local", "Remote", "VPN"), (28, 49, 23) if flagged else (58, 19, 23))[0]
            location = rng.choices(("Campus", "Home", "Roaming"), (33, 28, 39) if flagged else (56, 31, 13))[0]
            writer.writerow((
                f"U{user:04}", f"analyst{user:04}@example.test", f"192.0.2.{user}",
                hour, attempts, connection, rng.choice(("Desktop", "Laptop", "Mobile")), location,
                "Suspicious" if flagged else "Normal", 1 + index * 37, f"DEV-{device:04}",
                f"+1 202-555-{100 + user % 100:04}",
            ))


def make_lanl_shaped(root: Path) -> dict[str, Path]:
    """Create a small, generated schema fixture with known cross-source matches."""
    files = {kind: root / f"fixture-{kind}.txt.gz" for kind in ("auth", "proc", "redteam")}
    for kind, path in files.items():
        if path.exists():
            continue
        with path.open("xb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as zipped:
            for event in range(1, 721):
                timestamp = 1 + event * 16
                account = f"U{event % 13 + 1}@DOM1"
                source = f"C{event % 19 + 1}"
                destination = f"C{event % 7 + 30}"
                if kind == "auth":
                    status = "Fail" if event % 8 == 0 else "Success"
                    row = f"{timestamp},{account},{account},{source},{destination},Kerberos,Network,LogOn,{status}"
                elif kind == "proc":
                    row = f"{timestamp + 4},{account},{destination},P{event % 15},Start"
                elif event % 29 == 0:
                    row = f"{timestamp},{account},{source},{destination}"
                else:
                    continue
                zipped.write(f"{row}\n".encode("utf-8"))
            if kind == "auth":
                zipped.write(b"fixture-malformed-row\n")
    return files


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("forensic_auth_logs.csv"))
    parser.add_argument("--rows", type=int, default=10_000)
    parser.add_argument("--seed", type=int, default=419)
    args = parser.parse_args()
    if not 1 <= args.rows <= 2_000_000:
        parser.error("--rows must be between 1 and 2,000,000")
    generate(args.output, args.rows, args.seed)
    print(f"Wrote {args.rows:,} synthetic authentication records to {args.output}")
