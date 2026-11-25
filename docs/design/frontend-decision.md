# Frontend decision

React 18, Vite, TypeScript, Radix dialog and tab primitives, TanStack Query and Table, and Apache ECharts provide the requested workstation interactions. Hand-written CSS and locally bundled IBM Plex Sans and Mono follow the density and offline requirements in the frontend build brief. Tabler supplies the consistent 16 px icon set specified in that brief. Native browser and CSS features handle simple transitions and respect reduced-motion settings.

FastAPI serves the production bundle and API on the same loopback origin. Vite proxies the backend during frontend development. JSON payloads with a typed client and bounded polling cover local jobs. Python services own business rules. SQLite tracks cases, evidence, jobs, experiment manifests and audit entries. Parquet and DuckDB provide bounded analytical reads. Native dependencies use an isolated Python 3.12 environment to support the Apple Silicon machine learning stack. The machine's Python 3.15 installation remains available.

A greenfield build is required because the workspace contains no backend and no prior UI. Initial API gaps cover all case, evidence, ingestion, correlation, privacy, experiment, reporting and audit operations. Build and verify in that order, with the evaluation lab as the main research workflow.
