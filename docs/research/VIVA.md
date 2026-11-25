# Viva preparation

## What is the contribution?

The integration of evidence-linked investigation, privacy-preserving transformations and experimental comparison in one reproducible local workflow. The project uses established algorithms and evaluates their trade-offs experimentally.

## How can a finding be checked?

A finding retains the dataset version and physical source line. Evidence metadata retains the registered SHA-256. A correlation lists the exact rule that produced it. The user can open the related event and trace the route back to source storage.

## Why is missing red-team confirmation an unlabelled event?

The reference set lists selected known activity. Its absence leaves other events without confirmed labels. The app permits anomaly triage for these streams and uses synthetic labels for binary classification metrics.

## What changes when you mask or pseudonymize?

Masking suppresses values or part of their contents. A pseudonym uses HMAC-SHA-256 to map a value under a chosen scope and domain. Repeated pseudonyms support linkage. An investigator chooses how much linkage the use case requires and controls disclosure through an export policy.

## What does a computed epsilon mean?

Opacus tracks training steps, clipping, noise and Poisson sampling. Given delta, the RDP accountant reports epsilon for a record's participation under those assumptions. The experiment holds the pointwise transformation and training dataset definition fixed. Evidence, model evaluation, reports, account-level privacy and repeated releases need their own analysis.

## Why separate calibration and evaluation in the membership measurement?

A fixed classifier confidence boundary chosen on calibration data can overfit that group. Evaluating with disjoint members and nonmembers estimates generalization under the stated observation. The app reports counts, AUC, advantage and accuracy on the generated fixture in aggregate.

## What did the experiment find?

The three-seed forest baseline averaged F1 near 0.700. The HMAC forest averaged about 0.708 for the recorded scope, and masking averaged about 0.667. The DP runs averaged F1 about 0.617 to 0.626 while mean epsilon ranged from 0.849 to 4.997 at delta 10^-5. Similarity in the empirical membership metrics is conditional on the fixture and observation design.

## What limits a real deployment?

Clinic, legal, workplace or forensic deployment requires separate governance and a validated operational dataset. Full LANL scale was outside the available evidence in this workspace. The monitoring results are process-wide and from one Mac. Keys and curated data require operating-system access controls and independent evidence retention.
