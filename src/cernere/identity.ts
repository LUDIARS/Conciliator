import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { workersRepo } from "../db/repos.js";
import type { ResolvedIdentity, WorkerRow } from "../shared/types.js";

/** ロックファイル owner から作業者を起こすときの擬似ホスト名。 */
export const LOCKFILE_HOST = "office-lockfile";

function hash(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 12);
}

/**
 * worker id を identity から決定的に導出する。
 * Cernere user があればそれをキーにする (= 同じユーザは host が違っても同一 worker)。
 */
export function workerIdOf(identity: ResolvedIdentity): string {
  if (identity.cernereUserId) return `wk_c_${hash(identity.cernereUserId)}`;
  return `wk_${hash(`${identity.host} ${identity.label}`)}`;
}

/** ローカル API からの宣言 (host = この PC)。 */
export function identityFromLocal(
  label: string,
  cernereUserId: string | null = null,
): ResolvedIdentity {
  return { host: hostname(), label, kind: "human", cernereUserId };
}

/** Office ロックファイルの owner 文字列から (未認証)。 */
export function identityFromLockOwner(owner: string | null): ResolvedIdentity {
  return {
    host: LOCKFILE_HOST,
    label: owner ?? "(unknown)",
    kind: "human",
    cernereUserId: null,
  };
}

/** agent 経由 (Cernere 認証済み)。 */
export function identityFromAgent(a: {
  host: string;
  label: string;
  cernereUserId: string;
}): ResolvedIdentity {
  return { host: a.host, label: a.label, kind: "human", cernereUserId: a.cernereUserId };
}

/** AI セッション (hook 経由)。 */
export function identityForAi(label: string): ResolvedIdentity {
  return { host: hostname(), label, kind: "ai", cernereUserId: null };
}

/** identity から worker 行を upsert する。 */
export function ensureWorker(identity: ResolvedIdentity): WorkerRow {
  return workersRepo.upsert({
    id: workerIdOf(identity),
    host: identity.host,
    label: identity.label,
    kind: identity.kind,
    cernereUserId: identity.cernereUserId,
  });
}
