# Research deliverables

The recorded measurements use the built-in 10,000-row synthetic source and 24 model runs. The medium ingestion test uses an independently generated 250,000-row CSV. Measured analyses preserve the distinction between generated labels, unlabelled events and registered red-team references.

| File | Contents |
|---|---|
| measurements.json | Dataset and source scope, seeds, run manifests, curves, performance, privacy accounting and aggregate fixture linkage |
| summary.csv | Descriptive averages and sample standard deviations by configuration |
| figures/ | Vector PDF and PNG plots from the recorded runs, including the information-flow diagram |
| tex/privforensics-ieee.tex | Editable six-page IEEE conference source |
| project-report.md | Editable chapter text for the B.Tech report |
| VIVA.md | Viva preparation |

Published deliverables are in the project output/pdf directory. The paper uses the IEEEtran conference class. Its institution placeholder and the B.Tech guide placeholder are for the team's institutional information. [IEEE authoring templates](https://conferences.ieeeauthorcenter.ieee.org/write-your-paper/authoring-tools-and-templates/)

Rebuild the measured graphics and chapter report from project root.

    .venv/bin/python scripts/research_figures.py
    .venv/bin/python scripts/project_report.py

Rebuild the IEEE draft with Tectonic from its source directory.

    cd docs/research/tex
    tectonic -X compile -o ../../../output/pdf privforensics-ieee.tex

Use the saved research case on this machine to inspect the measured runs interactively.

    PRIVFORENSICS_DATA="$PWD/.runtime-research/state" ./scripts/run.sh

The benchmark script accepts a new dedicated storage directory. Its configurations and measurement scope are reproducible. Independent DP runs draw fresh noise, and HMAC runs need the retained key and case scope for exact feature reproduction.
