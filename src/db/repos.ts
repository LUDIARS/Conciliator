import type { DB } from "./index.js";
import { getDb } from "./index.js";
import { newId, nowSec } from "../shared/ids.js";
import type {
  AuditRow,
  ClaimOrigin,
  ClaimRow,
  ClaimStatus,
  CollisionPhase,
  CollisionRow,
  CollisionStatus,
  FileChangeKind,
  FileEventRow,
  RiskAlertRow,
  RiskRuleRow,
  Severity,
  SnapshotRow,
  StructureViolationRow,
  TriageStatus,
  WatchRootRow,
  WorkerKind,
  WorkerRow,
} from "../shared/types.js";

function db(): DB {
  return getDb();
}

// ── workers ───────────────────────────────────────────────────────────────
export const workersRepo = {
  upsert(input: {
    id: string;
    host: string;
    label: string;
    kind: WorkerKind;
    cernereUserId?: string | null;
  }): WorkerRow {
    const ts = nowSec();
    db()
      .prepare(
        `INSERT INTO workers (id, host, label, kind, cernere_user_id, first_seen, last_seen)
         VALUES (@id, @host, @label, @kind, @cernereUserId, @ts, @ts)
         ON CONFLICT(id) DO UPDATE SET
           last_seen = @ts, label = @label,
           cernere_user_id = COALESCE(@cernereUserId, cernere_user_id)`,
      )
      .run({
        id: input.id,
        host: input.host,
        label: input.label,
        kind: input.kind,
        cernereUserId: input.cernereUserId ?? null,
        ts,
      });
    return db().prepare("SELECT * FROM workers WHERE id = ?").get(input.id) as WorkerRow;
  },
  get(id: string): WorkerRow | undefined {
    return db().prepare("SELECT * FROM workers WHERE id = ?").get(id) as WorkerRow | undefined;
  },
  list(): WorkerRow[] {
    return db().prepare("SELECT * FROM workers ORDER BY last_seen DESC").all() as WorkerRow[];
  },
};

// ── watch_roots ───────────────────────────────────────────────────────────
export const watchRootsRepo = {
  replaceAll(rows: { id: string; label: string; path: string; configJson: string }[]): void {
    const ts = nowSec();
    const tx = db().transaction(() => {
      db().prepare("DELETE FROM watch_roots").run();
      const stmt = db().prepare(
        `INSERT INTO watch_roots (id, label, path, config_json, loaded_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const r of rows) stmt.run(r.id, r.label, r.path, r.configJson, ts);
    });
    tx();
  },
  list(): WatchRootRow[] {
    return db().prepare("SELECT * FROM watch_roots ORDER BY id").all() as WatchRootRow[];
  },
};

// ── file_events ───────────────────────────────────────────────────────────
export const fileEventsRepo = {
  insert(input: {
    rootId: string;
    path: string;
    kind: FileChangeKind;
    workerId?: string | null;
    sizeBytes?: number | null;
    hash?: string | null;
    ts?: number;
  }): FileEventRow {
    const ts = input.ts ?? nowSec();
    const info = db()
      .prepare(
        `INSERT INTO file_events (ts, root_id, path, kind, worker_id, size_bytes, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ts,
        input.rootId,
        input.path,
        input.kind,
        input.workerId ?? null,
        input.sizeBytes ?? null,
        input.hash ?? null,
      );
    return db()
      .prepare("SELECT * FROM file_events WHERE id = ?")
      .get(info.lastInsertRowid) as FileEventRow;
  },
  list(opts: { rootId?: string; since?: number; limit?: number } = {}): FileEventRow[] {
    const limit = Math.min(opts.limit ?? 200, 1000);
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts.rootId) {
      clauses.push("root_id = ?");
      params.push(opts.rootId);
    }
    if (opts.since != null) {
      clauses.push("ts >= ?");
      params.push(opts.since);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    params.push(limit);
    return db()
      .prepare(`SELECT * FROM file_events ${where} ORDER BY ts DESC, id DESC LIMIT ?`)
      .all(...params) as FileEventRow[];
  },
  /** ある event kind の直近 windowSec 件数 (Risk Engine 用)。 */
  countRecent(rootId: string, kind: FileChangeKind, sinceTs: number): number {
    const row = db()
      .prepare(
        "SELECT COUNT(*) AS n FROM file_events WHERE root_id = ? AND kind = ? AND ts >= ?",
      )
      .get(rootId, kind, sinceTs) as { n: number };
    return row.n;
  },
  purgeOlderThan(ts: number): number {
    return db().prepare("DELETE FROM file_events WHERE ts < ?").run(ts).changes;
  },
};

// ── claims ────────────────────────────────────────────────────────────────
export const claimsRepo = {
  insert(input: {
    workerId: string;
    rootId: string;
    path: string;
    origin: ClaimOrigin;
    intentText?: string | null;
    snapshotId?: string | null;
  }): ClaimRow {
    const id = newId("claim");
    const ts = nowSec();
    db()
      .prepare(
        `INSERT INTO claims
           (id, worker_id, root_id, path, origin, intent_text, status, snapshot_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      )
      .run(
        id,
        input.workerId,
        input.rootId,
        input.path,
        input.origin,
        input.intentText ?? null,
        input.snapshotId ?? null,
        ts,
        ts,
      );
    return claimsRepo.get(id)!;
  },
  get(id: string): ClaimRow | undefined {
    return db().prepare("SELECT * FROM claims WHERE id = ?").get(id) as ClaimRow | undefined;
  },
  /** 同一パスの active claim (省略時は全件)。 */
  activeForPath(path: string): ClaimRow[] {
    return db()
      .prepare("SELECT * FROM claims WHERE path = ? AND status = 'active' ORDER BY created_at")
      .all(path) as ClaimRow[];
  },
  findActive(workerId: string, path: string): ClaimRow | undefined {
    return db()
      .prepare(
        "SELECT * FROM claims WHERE worker_id = ? AND path = ? AND status = 'active' LIMIT 1",
      )
      .get(workerId, path) as ClaimRow | undefined;
  },
  list(status?: ClaimStatus): ClaimRow[] {
    if (status) {
      return db()
        .prepare("SELECT * FROM claims WHERE status = ? ORDER BY updated_at DESC")
        .all(status) as ClaimRow[];
    }
    return db().prepare("SELECT * FROM claims ORDER BY updated_at DESC").all() as ClaimRow[];
  },
  setIntent(id: string, intentText: string): ClaimRow | undefined {
    db()
      .prepare("UPDATE claims SET intent_text = ?, updated_at = ? WHERE id = ?")
      .run(intentText, nowSec(), id);
    return claimsRepo.get(id);
  },
  setSnapshot(id: string, snapshotId: string): void {
    db()
      .prepare("UPDATE claims SET snapshot_id = ?, updated_at = ? WHERE id = ?")
      .run(snapshotId, nowSec(), id);
  },
  touch(id: string): void {
    db().prepare("UPDATE claims SET updated_at = ? WHERE id = ?").run(nowSec(), id);
  },
  setStatus(id: string, status: ClaimStatus): ClaimRow | undefined {
    const ts = nowSec();
    const releasedAt = status === "released" ? ts : null;
    db()
      .prepare("UPDATE claims SET status = ?, updated_at = ?, released_at = ? WHERE id = ?")
      .run(status, ts, releasedAt, id);
    return claimsRepo.get(id);
  },
  /** updated_at が閾値より古い active claim を stale 化し、その行を返す。 */
  markStale(olderThan: number): ClaimRow[] {
    const stale = db()
      .prepare("SELECT * FROM claims WHERE status = 'active' AND updated_at < ?")
      .all(olderThan) as ClaimRow[];
    const stmt = db().prepare("UPDATE claims SET status = 'stale', updated_at = ? WHERE id = ?");
    const ts = nowSec();
    for (const c of stale) stmt.run(ts, c.id);
    return stale;
  },
};

// ── snapshots ─────────────────────────────────────────────────────────────
export const snapshotsRepo = {
  insert(input: {
    claimId: string;
    path: string;
    hash: string | null;
    storedPath: string;
    sizeBytes: number;
  }): SnapshotRow {
    const id = newId("snap");
    db()
      .prepare(
        `INSERT INTO snapshots (id, claim_id, path, hash, stored_path, size_bytes, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.claimId, input.path, input.hash, input.storedPath, input.sizeBytes, nowSec());
    return db().prepare("SELECT * FROM snapshots WHERE id = ?").get(id) as SnapshotRow;
  },
  get(id: string): SnapshotRow | undefined {
    return db().prepare("SELECT * FROM snapshots WHERE id = ?").get(id) as SnapshotRow | undefined;
  },
  /** released/stale な claim に紐づくスナップショットを GC 対象として返す。 */
  collectGarbage(): SnapshotRow[] {
    return db()
      .prepare(
        `SELECT s.* FROM snapshots s
         JOIN claims c ON c.id = s.claim_id
         WHERE c.status IN ('released', 'stale')
           AND NOT EXISTS (
             SELECT 1 FROM collisions col
             WHERE (col.claim_a = c.id OR col.claim_b = c.id)
               AND col.status IN ('open', 'ack')
           )`,
      )
      .all() as SnapshotRow[];
  },
  delete(id: string): void {
    db().prepare("DELETE FROM snapshots WHERE id = ?").run(id);
  },
};

// ── collisions ────────────────────────────────────────────────────────────
export const collisionsRepo = {
  insert(input: {
    path: string;
    claimA: string;
    claimB: string;
    phase: CollisionPhase;
  }): CollisionRow {
    const id = newId("col");
    db()
      .prepare(
        `INSERT INTO collisions (id, path, claim_a, claim_b, phase, status, detected_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?)`,
      )
      .run(id, input.path, input.claimA, input.claimB, input.phase, nowSec());
    return collisionsRepo.get(id)!;
  },
  get(id: string): CollisionRow | undefined {
    return db().prepare("SELECT * FROM collisions WHERE id = ?").get(id) as
      | CollisionRow
      | undefined;
  },
  /** 同じ claim ペアの未解決衝突を探す (重複起票防止)。 */
  findOpenPair(claimA: string, claimB: string): CollisionRow | undefined {
    return db()
      .prepare(
        `SELECT * FROM collisions
         WHERE status IN ('open', 'ack')
           AND ((claim_a = ? AND claim_b = ?) OR (claim_a = ? AND claim_b = ?))
         LIMIT 1`,
      )
      .get(claimA, claimB, claimB, claimA) as CollisionRow | undefined;
  },
  list(status?: CollisionStatus): CollisionRow[] {
    if (status) {
      return db()
        .prepare("SELECT * FROM collisions WHERE status = ? ORDER BY detected_at DESC")
        .all(status) as CollisionRow[];
    }
    return db()
      .prepare("SELECT * FROM collisions ORDER BY detected_at DESC")
      .all() as CollisionRow[];
  },
  setPhase(id: string, phase: CollisionPhase): CollisionRow | undefined {
    db().prepare("UPDATE collisions SET phase = ? WHERE id = ?").run(phase, id);
    return collisionsRepo.get(id);
  },
  setStatus(id: string, status: CollisionStatus): CollisionRow | undefined {
    const resolvedAt = status === "resolved" || status === "dismissed" ? nowSec() : null;
    db()
      .prepare("UPDATE collisions SET status = ?, resolved_at = ? WHERE id = ?")
      .run(status, resolvedAt, id);
    return collisionsRepo.get(id);
  },
};

// ── structure_violations ──────────────────────────────────────────────────
export const structureRepo = {
  insert(input: {
    rootId: string;
    path: string;
    ruleId: string;
    detail: string;
  }): StructureViolationRow {
    const id = newId("sv");
    db()
      .prepare(
        `INSERT INTO structure_violations (id, root_id, path, rule_id, detail, status, detected_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?)`,
      )
      .run(id, input.rootId, input.path, input.ruleId, input.detail, nowSec());
    return structureRepo.get(id)!;
  },
  get(id: string): StructureViolationRow | undefined {
    return db().prepare("SELECT * FROM structure_violations WHERE id = ?").get(id) as
      | StructureViolationRow
      | undefined;
  },
  /** 同一 (path, ruleId) の未解決違反があるか (重複起票防止)。 */
  hasOpen(rootId: string, path: string, ruleId: string): boolean {
    const row = db()
      .prepare(
        `SELECT 1 FROM structure_violations
         WHERE root_id = ? AND path = ? AND rule_id = ? AND status IN ('open', 'ack') LIMIT 1`,
      )
      .get(rootId, path, ruleId);
    return !!row;
  },
  list(status?: TriageStatus): StructureViolationRow[] {
    if (status) {
      return db()
        .prepare("SELECT * FROM structure_violations WHERE status = ? ORDER BY detected_at DESC")
        .all(status) as StructureViolationRow[];
    }
    return db()
      .prepare("SELECT * FROM structure_violations ORDER BY detected_at DESC")
      .all() as StructureViolationRow[];
  },
  setStatus(id: string, status: TriageStatus): StructureViolationRow | undefined {
    db().prepare("UPDATE structure_violations SET status = ? WHERE id = ?").run(status, id);
    return structureRepo.get(id);
  },
};

// ── risk_rules + risk_alerts ──────────────────────────────────────────────
export const riskRulesRepo = {
  replaceConfigRules(rules: { id: string; ruleJson: string }[]): void {
    const tx = db().transaction(() => {
      db().prepare("DELETE FROM risk_rules WHERE source = 'config'").run();
      const stmt = db().prepare(
        `INSERT INTO risk_rules (id, rule_json, enabled, source, added_at)
         VALUES (?, ?, 1, 'config', ?)
         ON CONFLICT(id) DO UPDATE SET rule_json = excluded.rule_json`,
      );
      const ts = nowSec();
      for (const r of rules) stmt.run(r.id, r.ruleJson, ts);
    });
    tx();
  },
  addRuntimeRule(id: string, ruleJson: string): RiskRuleRow {
    db()
      .prepare(
        `INSERT INTO risk_rules (id, rule_json, enabled, source, added_at)
         VALUES (?, ?, 1, 'runtime', ?)`,
      )
      .run(id, ruleJson, nowSec());
    return db().prepare("SELECT * FROM risk_rules WHERE id = ?").get(id) as RiskRuleRow;
  },
  setEnabled(id: string, enabled: boolean): void {
    db().prepare("UPDATE risk_rules SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
  },
  listEnabled(): RiskRuleRow[] {
    return db()
      .prepare("SELECT * FROM risk_rules WHERE enabled = 1 ORDER BY added_at")
      .all() as RiskRuleRow[];
  },
  listAll(): RiskRuleRow[] {
    return db().prepare("SELECT * FROM risk_rules ORDER BY added_at").all() as RiskRuleRow[];
  },
};

export const riskAlertsRepo = {
  insert(input: {
    ruleId: string;
    rootId: string | null;
    path: string;
    severity: Severity;
    detail: string;
  }): RiskAlertRow {
    const id = newId("risk");
    db()
      .prepare(
        `INSERT INTO risk_alerts (id, rule_id, root_id, path, severity, detail, status, detected_at)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
      )
      .run(id, input.ruleId, input.rootId, input.path, input.severity, input.detail, nowSec());
    return riskAlertsRepo.get(id)!;
  },
  get(id: string): RiskAlertRow | undefined {
    return db().prepare("SELECT * FROM risk_alerts WHERE id = ?").get(id) as
      | RiskAlertRow
      | undefined;
  },
  list(status?: TriageStatus): RiskAlertRow[] {
    if (status) {
      return db()
        .prepare("SELECT * FROM risk_alerts WHERE status = ? ORDER BY detected_at DESC")
        .all(status) as RiskAlertRow[];
    }
    return db()
      .prepare("SELECT * FROM risk_alerts ORDER BY detected_at DESC")
      .all() as RiskAlertRow[];
  },
  setStatus(id: string, status: TriageStatus): RiskAlertRow | undefined {
    db().prepare("UPDATE risk_alerts SET status = ? WHERE id = ?").run(status, id);
    return riskAlertsRepo.get(id);
  },
};

// ── audit_log ─────────────────────────────────────────────────────────────
export const auditRepo = {
  record(input: {
    actor: string;
    action: string;
    targetType: string;
    targetId: string;
    payload?: unknown;
  }): void {
    db()
      .prepare(
        `INSERT INTO audit_log (ts, actor, action, target_type, target_id, payload_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        nowSec(),
        input.actor,
        input.action,
        input.targetType,
        input.targetId,
        input.payload === undefined ? null : JSON.stringify(input.payload),
      );
  },
  list(limit = 200): AuditRow[] {
    return db()
      .prepare("SELECT * FROM audit_log ORDER BY ts DESC, id DESC LIMIT ?")
      .all(Math.min(limit, 1000)) as AuditRow[];
  },
};
