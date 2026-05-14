// バックエンド API のレスポンス形 (主要部分のみ)。

export type Severity = "low" | "medium" | "high";
export type TriageStatus = "open" | "ack" | "resolved" | "dismissed";

export interface WorkerLite {
  id: string;
  label: string;
  host: string;
  kind: "human" | "ai";
}

export interface Claim {
  id: string;
  worker_id: string;
  root_id: string;
  path: string;
  origin: "declared" | "inferred";
  intent_text: string | null;
  status: "active" | "released" | "stale";
  snapshot_id: string | null;
  created_at: number;
  updated_at: number;
  released_at: number | null;
  worker: WorkerLite | null;
}

export interface Collision {
  id: string;
  path: string;
  claim_a: string;
  claim_b: string;
  phase: "pre" | "manifest";
  status: "open" | "ack" | "resolved" | "dismissed";
  detected_at: number;
  resolved_at: number | null;
  claimADetail: { id: string; worker: string | null; intent: string | null } | null;
  claimBDetail: { id: string; worker: string | null; intent: string | null } | null;
}

export interface FileEvent {
  id: number;
  ts: number;
  root_id: string;
  path: string;
  kind: string;
  worker_id: string | null;
  size_bytes: number | null;
  hash: string | null;
}

export interface StructureViolation {
  id: string;
  root_id: string;
  path: string;
  rule_id: string;
  detail: string;
  status: TriageStatus;
  detected_at: number;
}

export interface RiskAlert {
  id: string;
  rule_id: string;
  root_id: string | null;
  path: string;
  severity: Severity;
  detail: string;
  status: TriageStatus;
  detected_at: number;
}

export interface Overview {
  watchRoots: number;
  workers: number;
  claims: { active: number; stale: number; released: number };
  collisions: { open: number; manifest: number; pre: number; resolved: number };
  structureViolations: { open: number };
  riskAlerts: { open: number; high: number };
}

export interface WatchRoot {
  id: string;
  label: string;
  path: string;
  loadedAt: number;
  recentEventCount: number;
  config: unknown;
}

export interface CellDiff {
  ref: string;
  baseline: string | null;
  a: string | null;
  b: string | null;
  changedByA: boolean;
  changedByB: boolean;
  conflict: boolean;
}

export interface XlsxDiffResponse {
  legend: { baseline: string; a: string; b: string };
  diff: {
    sheets: { name: string; cells: CellDiff[]; conflictCount: number }[];
    summary: { changedCells: number; conflictCells: number; sheets: number };
  };
}

export interface Notification {
  id: string;
  ts: number;
  severity: Severity;
  kind: string;
  title: string;
  body: string;
  ref?: { type: string; id: string };
}
