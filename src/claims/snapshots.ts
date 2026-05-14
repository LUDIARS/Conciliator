import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { snapshotsRepo } from "../db/repos.js";
import { logger } from "../shared/logger.js";
import type { SnapshotRow } from "../shared/types.js";
import { safeStatSize } from "../watcher/watcher.js";

const SNAPSHOT_DIR = resolve(process.env.CONCILIATOR_SNAPSHOT_DIR ?? "data/snapshots");

function ensureDir(): void {
  if (!existsSync(SNAPSHOT_DIR)) mkdirSync(SNAPSHOT_DIR, { recursive: true });
}

/**
 * claim 開始時点のファイル内容を data/snapshots/ に控える。
 *
 * `contentOverride` を渡すとそれを baseline とする (agent モード: ファイル実体は
 * agent 側にあるため、agent がアップロードした内容を server がここで保管する)。
 * 渡さない場合はローカル FS から読む (standalone / server のローカル監視)。
 *
 * snapshotMaxBytes 超過 / 読み取り不能なら null を返す
 * (claim は snapshot 無しでも成立する — クレバーマージが効かないだけ)。
 */
export function captureSnapshot(
  claimId: string,
  filePath: string,
  maxBytes: number,
  contentOverride?: Buffer,
): SnapshotRow | null {
  ensureDir();
  try {
    let content: Buffer;
    if (contentOverride) {
      content = contentOverride;
    } else {
      const size = safeStatSize(filePath);
      if (size == null) {
        logger.warn({ claimId, filePath }, "snapshot skipped — file not readable");
        return null;
      }
      content = readFileSync(filePath);
    }
    if (content.length > maxBytes) {
      logger.warn(
        { claimId, filePath, size: content.length, maxBytes },
        "snapshot skipped — exceeds max size",
      );
      return null;
    }
    const hash = createHash("sha1").update(content).digest("hex");
    const storedPath = resolve(SNAPSHOT_DIR, `${claimId}-${basename(filePath)}`);
    writeFileSync(storedPath, content);
    return snapshotsRepo.insert({
      claimId,
      path: filePath,
      hash,
      storedPath,
      sizeBytes: content.length,
    });
  } catch (err) {
    logger.warn({ err, claimId, filePath }, "snapshot capture failed");
    return null;
  }
}

// ── agent モード: アップロードされた snapshot 内容のステージング ──────────────
const staged = new Map<string, Buffer>();

/** agent がアップロードしたファイル内容を path で一時保持する。 */
export function stageContent(path: string, content: Buffer): void {
  staged.set(path, content);
}

/** ステージ済み内容を取り出して消費する (claim 生成時に使用)。 */
export function takeStagedContent(path: string): Buffer | undefined {
  const c = staged.get(path);
  if (c) staged.delete(path);
  return c;
}

/** snapshot の実体を読む (Merge Assistant 用)。 */
export function readSnapshotContent(snap: SnapshotRow): Buffer {
  return readFileSync(snap.stored_path);
}

/**
 * released / stale な claim に紐づく snapshot を GC する (個人データ非保管)。
 * 未解決の衝突に使われている snapshot は残す。
 */
export function gcSnapshots(): number {
  let removed = 0;
  for (const snap of snapshotsRepo.collectGarbage()) {
    try {
      if (existsSync(snap.stored_path)) rmSync(snap.stored_path);
    } catch (err) {
      logger.warn({ err, snap: snap.id }, "snapshot file removal failed");
    }
    snapshotsRepo.delete(snap.id);
    removed++;
  }
  if (removed > 0) logger.info({ removed }, "snapshots garbage-collected");
  return removed;
}
