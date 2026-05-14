import { claimsRepo, collisionsRepo } from "../db/repos.js";
import { eventBus } from "../events.js";
import { logger } from "../shared/logger.js";
import type { ClaimRow, CollisionRow } from "../shared/types.js";

/**
 * 衝突エンジン。
 * - claim 生成時: 同一パスに別 worker の active claim があれば phase=pre の衝突を起票
 *   → 「事前通知」(まだ顕在化していない、止まれる段階)
 * - ファイル変更時: その path に pre 衝突があれば phase=manifest に昇格
 *   → 「顕在化通知」(両者が実際に保存してしまった)
 */
export class CollisionEngine {
  /** claim が生まれたとき、同一パスの他 active claim との重複を検出する。 */
  onClaimCreated(claim: ClaimRow): CollisionRow[] {
    const created: CollisionRow[] = [];
    const peers = claimsRepo
      .activeForPath(claim.path)
      .filter((c) => c.id !== claim.id && c.worker_id !== claim.worker_id);

    for (const peer of peers) {
      const existing = collisionsRepo.findOpenPair(peer.id, claim.id);
      if (existing) continue;
      const collision = collisionsRepo.insert({
        path: claim.path,
        claimA: peer.id, // 先行 claim
        claimB: claim.id, // 後発 claim
        phase: "pre",
      });
      logger.warn(
        { collision: collision.id, path: claim.path, claimA: peer.id, claimB: claim.id },
        "pre-collision detected",
      );
      eventBus.emit({ type: "collision.detected", collision });
      created.push(collision);
    }
    return created;
  }

  /** トラッキング対象ファイルが変更されたとき、pre 衝突を manifest へ昇格する。 */
  onFileChanged(path: string): CollisionRow[] {
    const escalated: CollisionRow[] = [];
    const activeClaims = claimsRepo.activeForPath(path);
    if (activeClaims.length < 2) return escalated;

    for (const collision of collisionsRepo.list("open")) {
      if (collision.path !== path || collision.phase !== "pre") continue;
      const updated = collisionsRepo.setPhase(collision.id, "manifest");
      if (updated) {
        logger.warn({ collision: updated.id, path }, "collision escalated to manifest");
        eventBus.emit({ type: "collision.updated", collision: updated });
        escalated.push(updated);
      }
    }
    return escalated;
  }
}

export const collisionEngine = new CollisionEngine();
