import { fileEventsRepo } from "./db/repos.js";
import { claimManager } from "./claims/manager.js";
import { gcSnapshots } from "./claims/snapshots.js";
import { logger } from "./shared/logger.js";
import { nowSec } from "./shared/ids.js";

const SWEEP_INTERVAL_MS = Number(process.env.CONCILIATOR_SWEEP_INTERVAL_MS ?? 60_000);
/** file_events の保管期間 (日)。 */
const EVENT_RETENTION_DAYS = Number(process.env.CONCILIATOR_EVENT_RETENTION_DAYS ?? 30);

/**
 * バックグラウンド sweeper。
 * - 長時間更新の無い claim を stale 化
 * - released / stale な claim のスナップショットを GC (個人データ非保管)
 * - 古い file_events をパージ
 */
export function startSweeper(): () => void {
  const tick = (): void => {
    try {
      const stale = claimManager.sweepStale();
      const gcd = gcSnapshots();
      const purged = fileEventsRepo.purgeOlderThan(nowSec() - EVENT_RETENTION_DAYS * 86_400);
      if (stale || gcd || purged) {
        logger.info({ stale, snapshotsGc: gcd, eventsPurged: purged }, "sweeper tick");
      }
    } catch (err) {
      logger.error({ err }, "sweeper tick failed");
    }
  };

  const handle = setInterval(tick, SWEEP_INTERVAL_MS);
  logger.info({ intervalMs: SWEEP_INTERVAL_MS }, "sweeper started");
  return () => clearInterval(handle);
}
