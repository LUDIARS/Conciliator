import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * Office のロックファイル (owner file) を扱うユーティリティ。
 *
 * Excel/Word はファイルを開くと同じディレクトリに `~$<name>` という小さな
 * 隠しファイルを作る。その先頭バイトに「開いているユーザ名」が入っている。
 * これを読むことで「今そのファイルを誰が開いているか」を best-effort で特定できる。
 */

/** basename が Office ロックファイルか。 */
export function isLockFileName(name: string): boolean {
  return name.startsWith("~$");
}

/**
 * ロックファイルのパスから、ロック対象の実ファイルパスを推定する。
 * Excel は長いファイル名だと `~$` 以降を切り詰めるため完全ではない (best-effort)。
 */
export function resolveLockTarget(lockPath: string): string {
  const dir = dirname(lockPath);
  const lockBase = basename(lockPath); // 例: ~$Book1.xlsx
  const guess = join(dir, lockBase.slice(2)); // Book1.xlsx
  if (existsSync(guess)) return guess;

  // 切り詰めへの保険: 同ディレクトリで suffix 一致するファイルを探す
  const tail = lockBase.slice(2);
  try {
    // tail の後半部分 (拡張子含む) で一致を試す
    for (let drop = 1; drop <= 4 && drop < tail.length; drop++) {
      const cand = join(dir, tail.slice(drop));
      if (existsSync(cand)) return cand;
    }
  } catch {
    /* noop */
  }
  return guess;
}

/**
 * ロックファイルを開いているユーザ名を読み取る。読めなければ null。
 *
 * フォーマット: byte0 = ASCII ユーザ名の長さ L、byte1..1+L = CP1252 ユーザ名。
 */
export function readLockOwner(lockPath: string): string | null {
  try {
    const buf = readFileSync(lockPath);
    if (buf.length < 2) return null;
    const len = buf[0] ?? 0;
    if (len <= 0 || len > 54 || buf.length < 1 + len) return null;
    const raw = buf.subarray(1, 1 + len).toString("latin1").replace(/\0/g, "").trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}
