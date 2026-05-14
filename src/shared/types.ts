/** ドメイン型 (DB 行 + イベント) の定義。 */

export type WorkerKind = "human" | "ai";
export type FileChangeKind = "add" | "change" | "delete" | "rename" | "lock-open" | "lock-close";
export type ClaimOrigin = "declared" | "inferred";
export type ClaimStatus = "active" | "released" | "stale";
export type CollisionPhase = "pre" | "manifest";
export type CollisionStatus = "open" | "ack" | "resolved" | "dismissed";
export type TriageStatus = "open" | "ack" | "resolved" | "dismissed";
export type Severity = "low" | "medium" | "high";

export interface WorkerRow {
  id: string;
  host: string;
  label: string;
  kind: WorkerKind;
  /** Cernere で認証された場合のユーザ id (sub claim)。未認証なら null。 */
  cernere_user_id: string | null;
  first_seen: number;
  last_seen: number;
}

/**
 * 作業者の確定済みアイデンティティ。
 * ローカル (host+label) / ロックファイル owner / Cernere 認証 のいずれかから解決される。
 */
export interface ResolvedIdentity {
  host: string;
  label: string;
  kind: WorkerKind;
  cernereUserId: string | null;
}

export interface WatchRootRow {
  id: string;
  label: string;
  path: string;
  config_json: string;
  loaded_at: number;
}

export interface FileEventRow {
  id: number;
  ts: number;
  root_id: string;
  path: string;
  kind: FileChangeKind;
  worker_id: string | null;
  size_bytes: number | null;
  hash: string | null;
}

export interface ClaimRow {
  id: string;
  worker_id: string;
  root_id: string;
  path: string;
  origin: ClaimOrigin;
  intent_text: string | null;
  status: ClaimStatus;
  snapshot_id: string | null;
  created_at: number;
  updated_at: number;
  released_at: number | null;
}

export interface SnapshotRow {
  id: string;
  claim_id: string;
  path: string;
  hash: string | null;
  stored_path: string;
  size_bytes: number;
  captured_at: number;
}

export interface CollisionRow {
  id: string;
  path: string;
  claim_a: string;
  claim_b: string;
  phase: CollisionPhase;
  status: CollisionStatus;
  detected_at: number;
  resolved_at: number | null;
}

export interface StructureViolationRow {
  id: string;
  root_id: string;
  path: string;
  rule_id: string;
  detail: string;
  status: TriageStatus;
  detected_at: number;
}

export interface RiskAlertRow {
  id: string;
  rule_id: string;
  root_id: string | null;
  path: string;
  severity: Severity;
  detail: string;
  status: TriageStatus;
  detected_at: number;
}

export interface RiskRuleRow {
  id: string;
  rule_json: string;
  enabled: number;
  source: "config" | "runtime";
  added_at: number;
}

export interface AuditRow {
  id: number;
  ts: number;
  actor: string;
  action: string;
  target_type: string;
  target_id: string;
  payload_json: string | null;
}

/** ユーザへの通知。Notifier が WS + デスクトップ通知に流す。 */
export interface Notification {
  id: string;
  ts: number;
  severity: Severity;
  kind: "pre-collision" | "manifest-collision" | "structure" | "risk" | "intent-request";
  title: string;
  body: string;
  /** 関連レコードへの参照 (collision.id / violation.id / claim.id 等)。 */
  ref?: { type: string; id: string };
}
