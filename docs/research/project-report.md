# Abstract and objectives

Digital forensic work needs enough detail to connect authentication and process records, while each additional identifier can increase exposure. PrivForensics is a local research workstation that links source integrity, validated event browsing, privacy policy, AI triage and experimental evaluation. It preserves case and physical-line provenance through the case workflow.

The project has four compulsory objectives. It identifies direct and indirect privacy threats with documented field and rule checks. It implements field masking, scoped HMAC pseudonyms and Opacus differential privacy. It compares detection and observed privacy outcomes across controlled configurations. It measures compute overhead and bounded synthetic leakage. The application stores the result and provenance of each workflow in the same case.

Measurements use 10,000 generated authentication records and 24 model runs. A second workload tests ingestion at 250,000 generated rows. LANL schema support is exercised with compressed generated fixtures. The historical real-world data and earlier project files described in the brief were absent from the workspace during development.

## Problem statement

Develop a privacy-aware forensic AI workflow that supports useful analysis while minimizing exposure of sensitive personal or investigative data.

## Project contribution

The contribution is an integrated implementation and a documented experimental comparison. It applies established hashing, tree ensembles, neural training, keyed pseudonyms and privacy accounting. Investigators can inspect a rule, link a finding to evidence and assess how selecting an explicit transform changes model behavior.

# Background and input data

Authentication and endpoint sources can record logon outcomes, host roles and the identities associated with process activity. A correlation can use a shared clock and matching identifiers to narrow an investigation. The collection can also reveal routines, machines of interest and repeated account activity. Privacy assessment must consider both direct fields and what multiple sources can imply together.

## LANL schema support

The LANL Cyber1 documentation supplies the column order and elapsed clock for authentication, process events and red-team references. The application checks shape and data type, preserves the original physical row, and parses question marks into nulls where applicable. Authentication and process records remain unlabelled unless the case evidence supports a reference match. The source clock does not provide a civil-time date.

Generated auth and process gzip files contain 720 validated records each. Their generated red-team reference contains 24 validated rows. The authentication fixture also includes a malformed line. That example confirms the identified source role and elapsed-time rules while avoiding unsupported claims about actual attacks.

## Synthetic authentication experiment

The generator produces 10,000 authentication rows by default, with 6,220 generated normal and 3,780 generated suspicious labels. Values include a fictional email domain, reserved documentation IP addresses, login hour, attempts, context and a fictional device ID. Historical synthetic CSV files with the documented initial nine columns remain readable. Their elapsed time stays missing when the field is absent.

[[fixture]]

# System architecture and information flow

The frontend is a local React and TypeScript client. It shares one origin with the FastAPI server in the built application. The service validates requests, dispatches typed operations, and serves only generated frontend assets and authorized API responses. The business services own evidence, data, privacy, modeling and report logic.

[[architecture]]

## Metadata and work scheduling

SQLite stores cases, evidence references, queued work, audit entries, findings, policies, saved experiments and report metadata. A background worker hashes, validates, ingests and trains independently of page navigation. The worker provides IDs, progress and cooperative cancellation, and active request fingerprints suppress duplicate submissions. A failed or interrupted job retains its final state and a safe retry route.

## From source to report

The investigator registers bytes or a managed upload. Registration records SHA-256 and source metadata. The parser validates physical lines and writes Parquet row groups. DuckDB reads bounded results, which the API redacts before presentation. The investigator can correlate events, save a field policy and execute a learning configuration. Run artifacts retain versioned input, settings and counts. Report generation exports recorded sections and attaches a file digest to the local history.

# Evidence, data engineering and investigation

Evidence registration hashes fixed-size blocks and compares source identity before and after the operation. Verification rereads the same registered source and displays both saved and current SHA-256 values. A mismatch can mean changed bytes, and ingestion rejects a source whose registered identity no longer matches. Registering a large local file leaves its original location intact.

## Bounded streaming

Gzip and text input use iterative reads with line and field limits. A record that's too large is rejected and drained in bounded pieces. Malformed data retains counts and representative line references. Parquet row groups written by the parser keep the amount of pending data finite. A full source scan is deliberate. Samples and physical ranges support incremental work when disk capacity or time is limited.

Explorer queries apply allowlisted filters to compiled SQL and bind parameters. DuckDB has a time limit and finite memory and temporary-disk budgets. Explorer pages show schema, sample, distributions, validation and provenance, with the distinction between a scoped range and a complete source.

[[ingestion]]

## Correlation rules

R1 matches an authentication and red-team reference on elapsed second, source user, source machine and destination machine. R2 matches a supported role-paired account and computer within the selected interval. R3 checks a repeated account in the generated authentication stream. Each saved attachment retains the rule, time offset, dataset version and physical source line. These records help reproduce an investigator's reasoning and support review of the original source.

# Threat detection and protection controls

An identifier inventory scans a bounded sample using structured fields and text patterns. The heuristic records whether each of seven conditions triggers. The categories are direct exposure, linkage, unique combinations, attribute inference, unnecessary retained fields, membership and output leakage. A triggered count summarizes the observed rules. The user can inspect each condition and its scoped evidence.

## Mask, tokenize and drop

The protection editor assigns a policy to each field. Masking suppresses all or part of a sensitive representation, and dropping removes its column. HMAC computes a keyed digest from a version, scope, identifier domain and original value. The resulting token permits equality within its scope. Account and machine domains differ. Dataset, case and workspace scope support different combinations of permitted linkage.

Local storage keeps active and referenced historical key versions under restricted permissions. The workstation exposes the key status and ID. Rotation creates a new key version for future transformations. Retaining referenced versions supports rerunning experiments that depend on an older transformation.

## Safe inspection and export

The default record sample displays redacted values. An operator can confirm a single reveal for ten seconds, with an audit entry carrying the field and source position. Presentation mode disables this operation. The user can preview a protection policy and choose a bounded export. HMAC output may allow repeated records to be linked, so the confirmation describes the scope and the fields the policy retains.

# AI workflow and differential privacy

The Random Forest model uses defensible labels on the synthetic schema, bounded depth and balanced bootstrap weighting. Isolation Forest supports unlabelled activity and an independently calibrated score threshold. The two neural variants share a 24-unit hidden layer and one classification output. Models return scores and source references for investigation. The Random Forest also exposes global impurity-based feature importance.

## Feature layout and partitioning

The pointwise features include time, clipped failed attempts, context indicators and fixed categorical buckets. A separate Isolation Forest baseline adds frequency and relationship counts fitted on training rows. The evaluated holdout uses the latest 20 percent of the ordered sample. A seeded split of earlier rows reserves a disjoint membership diagnostic pool. The alternate account-group split isolates source accounts across partitions. No features fitted on private rows feed the DP-SGD wrapper.

## Privacy training

The private model uses PyTorch and Opacus with per-sample clipping, Gaussian noise and Poisson sampling. The accountant reports the observed training epsilon at the selected delta. The manifest includes actual clipping, noise, sample rate and optimizer steps. The research run uses a noncryptographic generator with fresh noise. It records a row-level training budget conditional on the defined input partition. Multiple rows for one account and repeated releases require a separate budget analysis.

The workbench stores confusion counts, detection metrics, aggregate membership results and sampled compute telemetry. The study reports mean and sample standard deviation across the measured seeds. Random Forest E0 to E3 track changes in suppression and equality. E4 uses DP-SGD, with standard neural E0 as the architecture-matched reference.

# Experimental results and interpretation

The recorded matrix contains 24 runs over three seeds. The eight configurations per seed include E0 through E3 Random Forest, standard neural E0 and three DP-SGD neural variants. The 2,000-row detection holdout supports accuracy, precision, recall, F1, ROC-AUC, average precision, false positive rate and false negative rate. Continuous scores support threshold review.

[[utility-table]]

[[detection-membership]]

E1 and E3 reduced mean held-out forest F1 against E0. E2 preserved comparable utility in the recorded scope. Because pseudonyms change the feature bucket assignment, the small measured increase should be tested across other key versions and data. The observed forest membership advantage declined with E1. The matched standard and private neural runs had membership AUC close to chance for the tested confidence-based observation.

# Privacy accounting and resource measurements

[[f1-epsilon]]

The mean recorded epsilon fell as noise increased. All private settings recorded lower mean F1 than the standard neural model at the held-out threshold. The small sample of noise settings does not resolve a monotonic F1 effect. Epsilon applies to the reported training mechanism at delta 10^-5, conditional on the partition and preprocessing. Aggregate membership performance applies to the generated diagnostic.

[[model-overhead]]

RSS measures the process and reflects runtime loading and allocator state. The first ordinary neural run incurred one-time optimizer setup and later runs were warm. The cost results describe these measurements. A controlled comparison of mechanism overhead should control initialization and randomize workload order.

# Synthetic leakage evaluation and limitations

The membership evaluation compares true-class confidence for different training and reserve records. It matches label strata, chooses a boundary on calibration rows and evaluates on disjoint rows. Its outputs include accuracy, ROC-AUC, attack advantage and the split counts. It is applied to models trained on the generated authentication fixture and summarizes outcomes without resolving membership for individual records.

[[linkage]]

In the generated linkage setup, the public auxiliary directory resolved original identifiers, while the selected partial mask gave ambiguous keys and HMAC hid comparability with the public directory. A stable token still repeated within the release. The auxiliary attributes and known candidate pool shape both match success and residual linkability. Reports place these assumptions next to their measurements.

## External validity

Generated distributions and known labels suit development and controlled evaluation. Actual field distributions, attack coverage and working-set size can differ substantially. Full real LANL processing and independent operational evaluation are pending the original authorized data. The chained local log supports consistency checks within the data store. Institutional custody, independently verified backups and user separation remain operational responsibilities. The study makes no production privacy guarantee for the entire application.

# Verification, user operation and future work

Backend tests verify evidence and audit integrity, registration bounds, gzip row groups, malformed-input handling, legacy CSV support, correlation, masking, HMAC rotation, data splits, actual DP accounting, report digests and reproducibility. The browser tests exercise case and evidence workflows, source inspection, finding creation, policy export, baseline and private training, leakage diagnostics, PDF export and local audit verification. Empty and populated states, both themes, keyboard navigation and reduced motion are inspected.

## Faculty demonstration

Launch with the documented start script. Load the example case, verify its authentication evidence and open its validation summary. In the timeline select a generated reference and read the relationship criteria. Next, inspect the generated authentication privacy inventory and apply a case-scoped HMAC policy. Run neural E0 and E4 in the lab, select both saved runs and review the detection and privacy measurements. Export an evaluation PDF and trace it in Audit History.

## Future evaluation

Obtain authorized real evidence, define reference labels and measure investigator outcomes at representative scale. Repeat the privacy diagnostic across independent generators, keys, architectures and model selection decisions. Control cold and warm timing, report repeated releases explicitly and evaluate account-level protection where suitable. Before an operational rollout, validate access controls and independent custody records in the intended environment.

# Team and references

The project plan assigns architecture, evidence and ingestion to Student 1. It assigns threat and protection controls to Student 2, AI and differential privacy to Student 3, and interface, performance, report and verification integration to Student 4. The contribution record documents actual participation separately from these planned areas.

## Research references

A. D. Kent, Comprehensive, Multi-Source Cyber-Security Events, Los Alamos National Laboratory, 2015. DOI 10.17021/1179829.

National Institute of Standards and Technology, Secure Hash Standard, FIPS PUB 180-4, 2015. DOI 10.6028/NIST.FIPS.180-4.

H. Krawczyk, M. Bellare and R. Canetti, HMAC, RFC 2104, 1997. DOI 10.17487/RFC2104.

L. Breiman, Random Forests, Machine Learning 45, pp. 5-32, 2001. DOI 10.1023/A:1010933404324.

F. T. Liu, K. M. Ting and Z.-H. Zhou, Isolation Forest, IEEE ICDM, 2008. DOI 10.1109/ICDM.2008.17.

M. Abadi et al., Deep Learning with Differential Privacy, ACM CCS, 2016. DOI 10.1145/2976749.2978318.

A. Yousefpour et al., Opacus, arXiv 2109.12298, 2021. I. Mironov, Rényi Differential Privacy, IEEE CSF, 2017. DOI 10.1109/CSF.2017.11.

R. Shokri, M. Stronati, C. Song and V. Shmatikov, Membership Inference Attacks Against Machine Learning Models, IEEE S&P, 2017. DOI 10.1109/SP.2017.41.
