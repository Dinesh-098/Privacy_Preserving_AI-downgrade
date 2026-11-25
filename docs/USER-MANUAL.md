# User manual

## First demonstration

1. Run the workstation and select **Load example case** on Overview. Watch Jobs finish the four ingestions.
2. In Evidence management, select a file, verify its hash and inspect the custody entries.
3. Open Dataset explorer. Choose the source and switch between Sample, Schema, Distributions, Validation and Provenance. The generated authentication capture includes a rejected row to show how validation works.
4. In Event correlation, select the red-team fixture and an event. Check the recorded rule and offset. Save a finding with the relevant attachments.
5. Choose Synthetic authentication in Privacy analysis. Open the rule explanations. Use Privacy protection to choose fields, generate a key, preview HMAC and save a policy.
6. In the Privacy–Utility Lab, select Synthetic authentication and run E0 with the Neural Network. Select E4 and train the DP Neural Network on the same scope. The completed runs populate Metrics and Curves. Frontier shows actual points with recorded budgets.
7. Review aggregate membership and linkage in Attack simulation, overhead in Performance and the recorded configurations under Reproduce. Generate a Privacy–utility evaluation PDF and confirm its history entry in Reports.

## Investigate a new source

Create an investigation. Register a local file by its absolute path or upload a small file. The application records SHA-256 in the background. Open the file and run **Verify hash** to compare it with the registered digest. If the hashes differ, recover the expected original or register the current bytes as a separate evidence version.

In Dataset explorer, ingest a small source range first and inspect its validation and provenance. For additional ranges, set **First physical line** to one after the previous completed range. The first line of a synthetic CSV is a header, so data starts at physical line 2. LANL logs start at line 1. Full-scan confirmation uses the source size, and the job shows measured throughput and ETA while it runs. Pause by cancelling at a supported checkpoint and continue with a previously completed range or its successor.

## Protection, analysis and export

Privacy Analysis reports structured and pattern detections from the first validated rows. Its count is based on triggered rules. In Privacy Protection, identifier scope determines which datasets can produce equal tokens. Review the before-and-after preview and the export scope before downloading a protected CSV. The Lab exposes pointwise benchmark configurations independently of dataset export policies.

Simple mode is the default. Advanced shows limits, rows, seeds, thresholds and DP controls. The model score threshold is configured before training or explored with stored score bins after evaluation. Use model flags as leads and corroborate them with source activity.

Use the active case switcher to keep pages in scope. Press Ctrl or Cmd+K to search the workspace, G then the page key to navigate, J or K to move through selectable table rows and question mark for the shortcut sheet. Presentation mode hides record reveals and sensitive case labels while demonstrating the workflow.

Reports include traceable evidence and run references. The default export omits case names, filenames, notes and raw evidence values. Use the paper preview and confirmation before publishing any report externally.
