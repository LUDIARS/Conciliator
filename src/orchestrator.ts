import { fileEventsRepo, watchRootsRepo } from "./db/repos.js";
import { eventBus, type EventSource } from "./events.js";
import { claimManager } from "./claims/manager.js";
import { collisionEngine } from "./collision/engine.js";
import { structureChecker } from "./structure/checker.js";
import { riskEngine } from "./risk/engine.js";
import { takeStagedContent } from "./claims/snapshots.js";
import { getResolvedRoots } from "./config/loader.js";
import { logger } from "./shared/logger.js";
import { nowSec } from "./shared/ids.js";
import {
  ensureWorker,
  identityFromAgent,
  identityFromLockOwner,
  workerIdOf,
} from "./cernere/identity.js";
import type { ResolvedIdentity } from "./shared/types.js";

/**
 * オーケストレータ。Watcher / agent-gateway が出すイベントを各エンジンへ配線する。
 * (Watcher は dumb なので、ここがドメインロジックの結線点)
 */
export function startOrchestrator(): void {
  syncWatchRoots();

  // バイナリ glob にマッチしたファイルの変更
  eventBus.on("file.changed", (e) => {
    const workerId = e.source?.kind === "agent" ? workerIdOf(identityFromAgent(e.source)) : null;
    const row = fileEventsRepo.insert({
      rootId: e.rootId,
      path: e.path,
      kind: e.kind,
      workerId,
      sizeBytes: e.sizeBytes ?? null,
      hash: e.hash ?? null,
      ts: e.ts,
    });
    eventBus.emit({ type: "file.persisted", row });

    riskEngine.onFilePersisted(row);
    if (e.kind === "add" || e.kind === "change") {
      structureChecker.checkPath(e.rootId, e.path);
    }
    claimManager.touchClaimsForPath(e.path);
    collisionEngine.onFileChanged(e.path);
  });

  // Office ロックファイルの出現 → claim を推測生成
  eventBus.on("lockfile.opened", (e) => {
    const identity = resolveIdentity(e.source, e.owner);
    ensureWorker(identity);
    fileEventsRepo.insert({
      rootId: e.rootId,
      path: e.targetPath,
      kind: "lock-open",
      workerId: workerIdOf(identity),
      ts: e.ts,
    });
    claimManager.infer({
      rootId: e.rootId,
      targetPath: e.targetPath,
      identity,
      snapshotContent: takeStagedContent(e.targetPath),
    });
  });

  // Office ロックファイルの消滅 → 推測 claim を release
  eventBus.on("lockfile.closed", (e) => {
    fileEventsRepo.insert({
      rootId: e.rootId,
      path: e.targetPath,
      kind: "lock-close",
      ts: e.ts,
    });
    claimManager.releaseInferredByLock(e.targetPath);
  });

  // claim が生まれた (宣言 / 推測どちらも) → 衝突検出
  eventBus.on("claim.created", (e) => {
    collisionEngine.onClaimCreated(e.claim);
  });

  // config reload → DB 同期 + ルート再検証
  eventBus.on("config.reloaded", () => {
    syncWatchRoots();
    riskEngine.syncFromConfig();
    structureChecker.checkRoots();
    logger.info("orchestrator: config reload applied (watcher restart は server が担当)");
  });

  logger.info("orchestrator wired");
}

/** イベント発生元から作業者 identity を確定する。agent 由来なら Cernere user を優先。 */
function resolveIdentity(source: EventSource | undefined, owner: string | null): ResolvedIdentity {
  if (source?.kind === "agent") return identityFromAgent(source);
  return identityFromLockOwner(owner);
}

function syncWatchRoots(): void {
  const roots = getResolvedRoots();
  watchRootsRepo.replaceAll(
    roots.map((r) => ({
      id: r.id,
      label: r.label,
      path: r.absPath,
      configJson: JSON.stringify(r),
    })),
  );
  logger.info({ count: roots.length, ts: nowSec() }, "watch roots synced to DB");
}
