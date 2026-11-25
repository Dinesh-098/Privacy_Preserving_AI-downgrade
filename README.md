# PrivForensics

**Privacy-Preserving AI in Forensics** is a local semester project about investigating suspicious logins. Start with a generated case, check the evidence, protect identifiers, and compare the measured results.

## Start the application

Run this from the project folder in the VS Code terminal.

```bash
./scripts/run.sh
```

Open [PrivForensics on localhost](http://127.0.0.1:8765). Use **Load example case** on Overview to register and ingest generated authentication records and three small LANL-shaped files. The example carries an **Example fixture** label. For your own work, create an investigation and register a file.

On a fresh checkout, use `./scripts/setup.sh` once from a terminal with registry access, then run the launch command. The setup uses local Python and Node tooling and the project lockfiles. A conventional Node 24 and pnpm 11 installation can also be used. The application needs no external services at runtime.

## Walk through one case

| Step | What to do |
| --- | --- |
| **Overview** | Load the example case or create an investigation. The checklist updates as you work. |
| **Evidence** | Upload a log, record its SHA-256, and verify that the file still matches. |
| **Review activity** | Open a source row and use event correlation to find nearby records. Save a finding with its source line. |
| **Protect data** | Scan for sensitive fields. Mask values, create HMAC tokens, or drop a field, then preview and save the policy. |
| **Flag logins** | Run Random Forest on labeled example data or Isolation Forest to find unusual activity. Open a flag to review the source. |
| **Compare results** | Run the baseline and a protection method. Training progress and measured results appear on the page. Compare F1, account linkage, membership advantage, and runtime. |
| **Reports** | Export the investigation summary or choose a different report from the dropdown. |

The default Simple view shows the case flow and core results. Select **Advanced** for additional model settings, curves, privacy checks, performance details, and the audit ledger.

### Explain the analysis

Masking hides sensitive values. HMAC replaces them with repeatable tokens generated using a secret key. DP-SGD changes training by clipping each example's contribution and adding noise. For a DP comparison, use the E0 Neural Network as the baseline for E4 on the same data. The default run uses up to 5,000 records and tests on records held back from training. The live comparison uses the values measured by that run.

The example labels come from rules in the generated data. Treat model flags as leads and check the original evidence before drawing conclusions. Opacus accounts for the training steps under the configured settings.

## Source files and local storage

- Supported analytical schemas are LANL Cyber1 authentication, process and red-team references, plus the documented synthetic authentication CSV. The app accepts gzip input directly. LANL elapsed seconds use the source clock.
- Registration accepts regular files inside the project and explicitly configured evidence directories. Managed uploads are limited to 24 MiB. For larger sources, register an absolute path in place. To allow a folder outside the project, pass it as `PRIVFORENSICS_EVIDENCE_ROOTS`, separated by colons for multiple roots.
- `.runtime/` holds the local SQLite database, derived Parquet, uploaded copies, key versions and generated reports. `PRIVFORENSICS_DATA` can select an independent data directory. After running the benchmark, open its saved research case with `PRIVFORENSICS_DATA="$PWD/.runtime-research/state" ./scripts/run.sh`.
- Full scans require confirmation. Start with a sample. A subsequent physical line range can continue from the last completed line. Gzip may replay earlier compressed bytes to seek a new range.
- The service binds to loopback and runs as the current OS user. The local workstation model uses filesystem permissions and browser origin checks. Leave this configuration on the local machine.

## Verification and research

```bash
.venv/bin/pytest -q
PATH="$PWD/.tooling/node/bin:$PATH" pnpm -C frontend test
.venv/bin/python scripts/evaluate.py --storage .runtime-research
.venv/bin/python scripts/research_figures.py
```

The browser suite uses locally installed Google Chrome. The benchmark saves data hashes, configuration and genuine measured outputs. Replaying an HMAC run requires its recorded key version and case scope. DP training draws fresh noise.

- [User manual](docs/USER-MANUAL.md)
- [Architecture and data flow](docs/ARCHITECTURE.md)
- [Verification and limits](docs/TESTING.md)
- [Design system](docs/design/design-system.md)
- [Team and roles](docs/TEAM.md)
- [Study measurements](docs/research/measurements.json)
- [Summary CSV](docs/research/summary.csv)
- [Viva preparation](docs/research/VIVA.md)

- [IEEE paper source](docs/research/tex/privforensics-ieee.tex)
- [B.Tech project report](docs/research/project-report.md)
