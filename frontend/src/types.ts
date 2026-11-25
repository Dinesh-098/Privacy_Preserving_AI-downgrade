export type CaseStatus = "open" | "in_review" | "closed";
export type Investigation = {
  id: string; title: string; description: string; status: CaseStatus; created_at: string; updated_at: string;
  evidence_count: number; verified_count: number; mismatch_count: number; dataset_count: number;
  finding_count: number; policy_count: number; run_count: number; report_count: number;
};
export type Evidence = {
  id: string; case_id: string; name: string; source: "local" | "upload" | "fixture"; sha256: string; size: number;
  created_at: string; verified_at: string | null; verified_sha256: string | null; integrity: "registered" | "verified" | "mismatch";
  path?: string;
};
export type Kind = "auth" | "proc" | "redteam" | "synthetic";
export type Origin = "fixture" | "synthetic" | "registered";
export type Dataset = {
  id: string; case_id: string; evidence_id: string; kind: Kind; name: string; origin: Origin; sha256: string;
  evidence_sha256?: string; first_line: number; last_line: number; limit_rows: number | null;
  rows: number; malformed: number; created_at: string;
  meta: {
    schema_version: string; fields: string[]; present: Record<string, number>; label_counts: Record<string, number>;
    errors: Record<string, number>; error_examples: { line: number; reason: string }[];
    bins: [number, number][]; bin_seconds: number; min_time: number | null; max_time: number | null;
    duration_s: number; bytes_read: number; rows_per_s: number; mb_per_s: number; clock: string;
  };
};
export type Source = {
  dataset_id: string; dataset_hash: string; evidence_id: string; line: number; name: string; clock: string; origin: Origin;
};
export type FieldValue = string | number | null;
export type Event = {
  line: number; time: number | null; kind: Kind; label_status: string; fields: Record<string, FieldValue>; source: Source;
};
export type Timeline = { events: Event[]; predictions: { event: Event; run_id: string; score: number }[]; cap: number; scope: string[]; clock: string; truncated: boolean };
export type Association = { id: string; type: string; why: string; seconds: number };
export type Related = { event: Event; related: { event: Event; rule: Association }[]; window: number; truncated: boolean };
export type Finding = {
  id: string; title: string; severity: string; notes: string; created_at: string;
  events: { anchor: Event; related: Related["related"]; window: number };
};
export type Job = {
  id: string; case_id: string; type: string; label: string; status: "queued" | "running" | "completed" | "failed" | "cancelled";
  cancel_requested: boolean; created_at: string; started_at: string | null; finished_at: string | null;
  progress: { phase: string; current?: number; total?: number; unit?: string; fraction: number | null;
    elapsed?: number; rate?: number | null; eta?: number | null };
  result: Record<string, unknown> | null; error: string | null;
};
export type Audit = {
  sequence: number; time: string; actor: string; action: string; entity: string; case_id: string | null;
  detail: Record<string, unknown>; previous_hash: string; entry_hash: string;
};
export type KeyStatus = { configured: boolean; version: string | null; created_at: string | null };
export type Health = {
  ready: boolean; version: string; key: KeyStatus; storage: string;
  limits: { upload_bytes: number; rows: number; query_seconds: number; chunk_rows: number; workers: number };
};
export type Environment = {
  python: string; os: string; machine: string; cores: number; ram: number; free: number;
  packages: Record<string, string | null>; evidence_roots: string[];
};
export type PageResult<T> = { items: T[]; total?: number | null; has_more?: boolean };
export type Scope = "dataset" | "case" | "workspace";
export type Rule = "keep" | "mask" | "hmac" | "drop";
export type Policy = { rules: Record<string, Rule>; scope: Scope; updated_at: string | null };
export type PrivacyProfile = {
  inventory: {
    field: string; detector: string; types: string[]; count: number; risk: "high" | "medium";
    recommended: string; samples: { value: string; source: Source }[];
  }[];
  sample_rows: number; score: number; scope: string; rules: { name: string; triggered: boolean; rule: string }[];
};
export type Preview = {
  rows: { source: Source; before: Record<string, FieldValue>; after: Record<string, FieldValue> }[];
  key_version: string | null; scope: Scope; rules: Policy["rules"];
};
export type Model = "random_forest" | "isolation_forest" | "neural" | "dp_neural";
export type Mechanism = "E0" | "E1" | "E2" | "E3" | "E4";
export type RunConfig = {
  dataset_id: string; model: Model; mechanism: Mechanism; seed: number; split: "temporal" | "group";
  max_rows: number; threshold: number; contamination: number; trees: number; epochs: number;
  batch_size: number; delta: number; noise: number; clip: number; target_epsilon: number | null;
};
export type RunSummary = {
  id: string; case_id: string; dataset_id: string; created_at: string; config: RunConfig;
  manifest: { config_hash: string; dataset_hash: string; source_sha256: string; dataset_name: string; origin: Origin;
    key_version: string | null; feature_version: string; model_version: string; started_at: string; completed_at: string;
    environment: Record<string, string>; split: Record<string, string | number> };
  results: {
    metrics: Record<string, number | null>; counts: { train: number; holdout: number; privacy_holdout: number; flagged: number };
    confusion: [number, number, number, number] | null; threshold: number;
    dp: { epsilon: number; delta: number; accountant: string; noise: number; clip: number; sampling_rate: number;
      steps: number; secure_mode: boolean } | null;
    membership: Membership | null; performance: Record<string, number>;
    linkage?: { mechanism: string; success: number; linkability: number; matches: number; possible: number } | null;
  };
};
export type Membership = {
  accuracy: number; auc: number; advantage: number; members: number; nonmembers: number;
  calibration_members: number; calibration_nonmembers: number; roc: [number, number][];
};
export type Run = RunSummary & { results: RunSummary["results"] & {
  roc: [number, number][]; pr: [number, number][]; findings: { score: number; event: Event }[];
  importance: { feature: string; weight: number }[]; score_bins: [number, number][];
} };
export type Linkability = {
  n: number; auxiliary_n: number; assumptions: string; dataset_hash: string; fields: string[];
  results: { mechanism: string; success: number; linkability: number; matches: number; possible: number }[];
};
export type ReportType = "investigation" | "evidence" | "correlation" | "privacy" | "evaluation" | "leakage" | "performance" | "audit";
export type ReportFormat = "pdf" | "csv" | "html" | "md";
export type Report = {
  id: string; case_id: string; type: ReportType; format: ReportFormat; sha256: string; size: number; created_at: string;
};
export type ReportData = { title: string; subtitle: string; generated_at: string; case_id: string; redaction: string;
  sections: { title: string; columns: string[]; rows: (string | number | null)[][]; text?: string }[] };
