import { claimsRepo } from "../db/repos.js";
import { eventBus } from "../events.js";
import { getConfig } from "../config/loader.js";
import { logger } from "../shared/logger.js";
import type { ClaimRow, ResolvedIdentity } from "../shared/types.js";
import { ensureWorker } from "../cernere/identity.js";
import { captureSnapshot } from "./snapshots.js";

/**
 * 作業クレームのライフサイクルを管理する。
 * - 明示宣言 (API) と、ロックファイル検知 / agent からの推測生成の両方を扱う
 * - claim 生成時に baseline スナップショットを取得する
 * - 作業者の identity は ResolvedIdentity に正規化済み (local / lockfile owner / Cernere)
 */
export class ClaimManager {
  /** 明示宣言で claim を作る (API から)。 */
  declare(input: {
    rootId: string;
    path: string;
    identity: ResolvedIdentity;
    intentText?: string | null;
    snapshotContent?: Buffer;
  }): ClaimRow {
    const wk = ensureWorker(input.identity);

    const existing = claimsRepo.findActive(wk.id, input.path);
    if (existing) {
      claimsRepo.touch(existing.id);
      if (input.intentText) claimsRepo.setIntent(existing.id, input.intentText);
      const updated = claimsRepo.get(existing.id)!;
      eventBus.emit({ type: "claim.updated", claim: updated });
      return updated;
    }

    const claim = claimsRepo.insert({
      workerId: wk.id,
      rootId: input.rootId,
      path: input.path,
      origin: "declared",
      intentText: input.intentText ?? null,
    });
    this.attachSnapshot(claim, input.snapshotContent);
    logger.info({ claim: claim.id, path: claim.path, worker: wk.label }, "claim declared");
    eventBus.emit({ type: "claim.created", claim: claimsRepo.get(claim.id)! });
    return claimsRepo.get(claim.id)!;
  }

  /** ロックファイル検知 / agent / AI hook から claim を推測生成する。 */
  infer(input: {
    rootId: string;
    targetPath: string;
    identity: ResolvedIdentity;
    snapshotContent?: Buffer;
  }): ClaimRow {
    const wk = ensureWorker(input.identity);

    const existing = claimsRepo.findActive(wk.id, input.targetPath);
    if (existing) {
      claimsRepo.touch(existing.id);
      return claimsRepo.get(existing.id)!;
    }

    const claim = claimsRepo.insert({
      workerId: wk.id,
      rootId: input.rootId,
      path: input.targetPath,
      origin: "inferred",
    });
    this.attachSnapshot(claim, input.snapshotContent);
    logger.info(
      { claim: claim.id, path: claim.path, worker: wk.label, cernere: wk.cernere_user_id },
      "claim inferred",
    );
    eventBus.emit({ type: "claim.created", claim: claimsRepo.get(claim.id)! });
    return claimsRepo.get(claim.id)!;
  }

  /** ロックファイル消滅時、その path の推測 claim を release する。 */
  releaseInferredByLock(targetPath: string): void {
    for (const claim of claimsRepo.activeForPath(targetPath)) {
      if (claim.origin !== "inferred") continue;
      const released = claimsRepo.setStatus(claim.id, "released");
      if (released) {
        logger.info({ claim: claim.id, path: targetPath }, "inferred claim released (lock closed)");
        eventBus.emit({ type: "claim.released", claim: released });
      }
    }
  }

  /** 意思確認の回答を claim に記録する。 */
  setIntent(claimId: string, intentText: string): ClaimRow | undefined {
    const claim = claimsRepo.setIntent(claimId, intentText);
    if (claim) eventBus.emit({ type: "claim.updated", claim });
    return claim;
  }

  release(claimId: string): ClaimRow | undefined {
    const claim = claimsRepo.setStatus(claimId, "released");
    if (claim) {
      logger.info({ claim: claimId }, "claim released");
      eventBus.emit({ type: "claim.released", claim });
    }
    return claim;
  }

  /** ファイル変更を受けて、対応する active claim の updated_at を更新する。 */
  touchClaimsForPath(path: string): void {
    for (const claim of claimsRepo.activeForPath(path)) {
      claimsRepo.touch(claim.id);
    }
  }

  /** sweeper から定期呼び出し。長時間更新の無い claim を stale 化する。 */
  sweepStale(): number {
    const olderThan = Math.floor(Date.now() / 1000) - getConfig().claim.staleAfterSec;
    const stale = claimsRepo.markStale(olderThan);
    for (const claim of stale) {
      const updated = claimsRepo.get(claim.id);
      if (updated) {
        logger.info({ claim: claim.id }, "claim marked stale");
        eventBus.emit({ type: "claim.updated", claim: updated });
      }
    }
    return stale.length;
  }

  private attachSnapshot(claim: ClaimRow, content?: Buffer): void {
    const snap = captureSnapshot(
      claim.id,
      claim.path,
      getConfig().claim.snapshotMaxBytes,
      content,
    );
    if (snap) claimsRepo.setSnapshot(claim.id, snap.id);
  }
}

export const claimManager = new ClaimManager();
