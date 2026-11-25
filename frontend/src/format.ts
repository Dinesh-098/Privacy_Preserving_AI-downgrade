import type { CaseStatus, Kind, Mechanism, Model } from "./types";

export const num = (value?: number | null, digits = 0) =>
  value === undefined || value === null ? "—" : new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
export const metric = (value?: number | null, digits = 3) =>
  value === undefined || value === null ? "—" : value.toFixed(digits);
export const pct = (value?: number | null, digits = 1) =>
  value === undefined || value === null ? "—" : (value * 100).toFixed(digits) + "%";
export const sec = (value?: number | null) =>
  value === undefined || value === null ? "—" : value < 60 ? num(value, 2) + " s" : num(value / 60, 1) + " min";
export const utc = (value?: string | null) => value ? value.replace("T", " ") : "—";
export function bytes(value?: number | null) {
  if (value === undefined || value === null) return "—";
  if (value >= 1024 ** 3) return num(value / 1024 ** 3, 2) + " GiB";
  if (value >= 1024 ** 2) return num(value / 1024 ** 2, 2) + " MiB";
  if (value >= 1024) return num(value / 1024, 1) + " KiB";
  return num(value) + " B";
}

export const kindName: Record<Kind, string> = { auth: "Authentication", proc: "Process", redteam: "Red-team reference",
  synthetic: "Synthetic authentication" };
export const caseStatus: Record<CaseStatus, string> = { open: "Open", in_review: "In review", closed: "Closed" };
export const modelName: Record<Model, string> = {
  random_forest: "Random Forest", isolation_forest: "Isolation Forest", neural: "Neural Network", dp_neural: "DP Neural Network",
};
export const mechanismName: Record<Mechanism, string> = {
  E0: "Baseline", E1: "Masking", E2: "HMAC pseudonymization", E3: "Masking + HMAC", E4: "DP-SGD",
};
export const fields: Record<string, string> = {
  line: "Source line", ts: "Elapsed seconds", src_user: "Source account", dst_user: "Destination account",
  src_host: "Source host", dst_host: "Destination host", auth_type: "Authentication type", logon_type: "Logon type",
  orientation: "Orientation", outcome: "Outcome", process: "Process", event_type: "Event type", email: "Email",
  ip: "IP address", hour: "Login hour", attempts: "Failed attempts", access: "Access type", device_type: "Device type",
  location: "Location", synthetic_label: "Synthetic label", device_id: "Device ID", phone: "Phone",
};
export const fieldName = (value: string) => fields[value] ?? value;
export const activityName = (value: string) => {
  const names: Record<string, string> = {
    "case.created": "Investigation created", "case.updated": "Investigation updated", "dataset.ingested": "Dataset ingested",
    "evidence.registered": "Evidence registered", "evidence.verified": "Evidence verified", "evidence.mismatch": "Hash mismatch",
    "policy.saved": "Protection policy saved", "run.completed": "Experiment saved", "finding.saved": "Finding saved",
    "report.generated": "Report generated", "field.revealed": "Field temporarily revealed",
    "job.completed": "Job completed", "job.queued": "Job queued", "job.failed": "Job failed",
  };
  return names[value] ?? value.replaceAll(".", " ").replace(/^./, char => char.toUpperCase());
};
