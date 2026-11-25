# Verification record

Verified on the Apple Silicon workspace with Python 3.12.16, Node 24.22.3, DuckDB 1.5.6, PyArrow 24.0.0, scikit-learn 1.9.1, PyTorch 2.15.0 and Opacus 1.6.0.

## Automated checks

The final verification run passed 11 Python integration tests and 4 Playwright tests.

| Check | Verified behavior |
|---|---|
| Python integration suite | Evidence registration and changed hashes, local origin and path controls, byte-stable read, gzip ranges, malformed rows, Parquet row groups, legacy CSV, R1/R2 finding trace, PII, scoped HMAC, policy export, timed reveal scope, deduplication and cooperative cancellation |
| Learning and research tests | Temporal and group partitions, four model types, all E0–E4 settings, threshold outputs, Opacus fixed-noise and target-epsilon modes, matched aggregate fixture diagnostics, protected key rotation and repeatable non-DP configurations |
| Reports | Verified actual PDF, CSV, HTML and Markdown bytes against saved checksums, redacted options and accountant in output |
| Playwright evidence workflow | Create a case, upload evidence, verify SHA-256, ingest a source, inspect a redacted record, confirm reveal |
| Playwright research workflow | Load a fixture, record an explainable finding, generate a key, preview and save a policy, download transformed CSV, run E0 and E4, compare metrics and charts, view manifests and leakage, download PDF and verify audit |
| Browser matrix | 15 routes, empty and populated case context, both themes, axe serious and critical checks, zero page or console errors and zero requests off the origin |
| Keyboard and preferences | Ctrl+K palette, keyboard navigation, page shortcuts, theme, presentation mode and reduced motion persist across reloads |
| Publication deliverables | Both PDFs rendered and reviewed page by page. IEEE conference draft has 6 pages including references. B.Tech draft has 13 pages. |

## Development gates

| Stage | Files and outcome | Verification |
|---|---|---|
| D1 | Workspace assessment and frontend decision in design documentation | VS Code workspace was empty, with no existing UI to capture or tests to run |
| D2 | Semantic tokens, project SVGs, local fonts and living design system | Rendered both themes and checked accessibility |
| D3 | API client, case-aware shell, job tray and commands | First browser evidence workflow passed, with the first-build screenshots under D3 |
| D4 | Case, evidence and explorer services and pages | Registration, hash match and mismatch, gzip ingestion, physical ranges and source inspection passed |
| D5 | Correlation rules, timeline, model flags and stored findings | Generated R1 exact reference and R2 process association preserved with source links |
| D6 | Threat rules, protection workspace, versioned keys and export | Structured and pattern detectors, case and domain separation, and redacted preview and export checked |
| D7 | AI analysis, Lab, aggregate leakage and performance | Four models, 24 measured runs, fixed and target accountant paths, rerun, actual run charts and medium streaming check |
| D8 | Reporting, audit and settings | Eight report categories, four formats, saved digests, audit verification and preferences |
| D9 | Accessibility corrections, visual review and lazy bundles | Browser matrix at 1440×900, 1920×1080, 1280×800 and 1280×720 with reduced motion. Images under design screenshots |
| Academic | IEEE source, B.Tech text, benchmark JSON, summary CSV and figure source | Measured inputs and pagination confirmed |

## Runtime and footprint

The 250,000-row generated CSV scan validated 27.33 MB in 2.79 seconds and recorded about 89,625 valid rows/s and 9.80 source MB/s. This is a single measured local workload. Compressed file handling was verified on generated gzip fixtures. The full LANL captures were absent. The measured model timings include process and launch-order effects.

The Vite build reports about 120 kB gzip for the initial JavaScript against a 130 kB budget. Lazy route JavaScript is under 11 kB gzip per displayed route chunk. ECharts and its canvas renderer total about 203 kB gzip against a 215 kB combined budget, loaded on demand. The browser uses locally bundled fonts.

The research environment logs warnings from Opacus about the research-mode random generator and the numerical accountant search. The UI displays its recorded accountant and scope. The backend test library also emits a TestClient compatibility deprecation warning on the resolved Starlette version.

## Commands

Run backend integration with the locked project environment and browser checks with the installed Chrome.

    .venv/bin/pytest -q
    PATH="$PWD/.tooling/node/bin:$PATH" pnpm -C frontend test
    PF_STAGE_SCREENSHOTS="$PWD/docs/design/screenshots" PATH="$PWD/.tooling/node/bin:$PATH" pnpm -C frontend test

The browser server starts on a separate port with transient data. The launch command in the project README uses port 8765 and a persistent local case store.
