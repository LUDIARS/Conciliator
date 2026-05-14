import chokidar, { type FSWatcher } from "chokidar";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, relative } from "node:path";
import { eventBus } from "../events.js";
import { logger } from "../shared/logger.js";
import { nowSec } from "../shared/ids.js";
import { getResolvedRoots, type ResolvedWatchRoot } from "../config/loader.js";
import { isLockFileName, readLockOwner, resolveLockTarget } from "./lockfile.js";

/** ハッシュを計算する上限サイズ (これを超えるファイルは hash=null)。 */
const HASH_MAX_BYTES = 5 * 1024 * 1024;

function hashFile(path: string, sizeBytes: number): string | null {
  if (sizeBytes > HASH_MAX_BYTES) return null;
  try {
    return createHash("sha1").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

/**
 * 監視ルートを chokidar で再帰監視する。
 * - Office ロックファイル (`~$*`) → lockfile.opened / lockfile.closed
 * - それ以外 → file.changed (add / change / delete)
 *
 * バイナリ glob 判定や構成・リスク判定は下流コンポーネントが行う (watcher は dumb)。
 */
export class Watcher {
  private watchers: FSWatcher[] = [];

  start(): void {
    for (const root of getResolvedRoots()) {
      this.watchRoot(root);
    }
  }

  private watchRoot(root: ResolvedWatchRoot): void {
    // chokidar の ignore からはロックファイルパターンを外す (lockfile 検知に必要)。
    const ignored = root.ignore.filter((g) => !g.includes("~$"));

    const watcher = chokidar.watch(root.absPath, {
      ignored,
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
      alwaysStat: true,
    });

    watcher
      .on("add", (path, stats) => this.onAdd(root, path, stats?.size ?? 0))
      .on("change", (path, stats) => this.onChange(root, path, stats?.size ?? 0))
      .on("unlink", (path) => this.onUnlink(root, path))
      .on("error", (err) => logger.error({ err, root: root.id }, "watcher error"))
      .on("ready", () => logger.info({ root: root.id, path: root.absPath }, "watching root"));

    this.watchers.push(watcher);
  }

  private onAdd(root: ResolvedWatchRoot, path: string, size: number): void {
    if (isLockFileName(basename(path))) {
      const targetPath = resolveLockTarget(path);
      const owner = readLockOwner(path);
      logger.debug({ root: root.id, targetPath, owner }, "lockfile opened");
      eventBus.emit({
        type: "lockfile.opened",
        rootId: root.id,
        targetPath,
        lockPath: path,
        owner,
        ts: nowSec(),
      });
      return;
    }
    eventBus.emit({
      type: "file.changed",
      rootId: root.id,
      path,
      kind: "add",
      ts: nowSec(),
      sizeBytes: size,
      hash: hashFile(path, size) ?? undefined,
    });
  }

  private onChange(root: ResolvedWatchRoot, path: string, size: number): void {
    if (isLockFileName(basename(path))) return; // ロックファイルの中身変化は無視
    eventBus.emit({
      type: "file.changed",
      rootId: root.id,
      path,
      kind: "change",
      ts: nowSec(),
      sizeBytes: size,
      hash: hashFile(path, size) ?? undefined,
    });
  }

  private onUnlink(root: ResolvedWatchRoot, path: string): void {
    if (isLockFileName(basename(path))) {
      const targetPath = resolveLockTarget(path);
      logger.debug({ root: root.id, targetPath }, "lockfile closed");
      eventBus.emit({
        type: "lockfile.closed",
        rootId: root.id,
        targetPath,
        lockPath: path,
        ts: nowSec(),
      });
      return;
    }
    eventBus.emit({
      type: "file.changed",
      rootId: root.id,
      path,
      kind: "delete",
      ts: nowSec(),
    });
  }

  async stop(): Promise<void> {
    await Promise.all(this.watchers.map((w) => w.close()));
    this.watchers = [];
  }
}

/** path が root 配下にあるか。 */
export function isUnderRoot(root: ResolvedWatchRoot, path: string): boolean {
  const rel = relative(root.absPath, path);
  return !rel.startsWith("..") && !rel.startsWith("/") && !/^[A-Za-z]:/.test(rel);
}

/** ファイルが今も存在しサイズが取れるか。 */
export function safeStatSize(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}
