import picomatch from "picomatch";
import { relative } from "node:path";

/** Windows のバックスラッシュを正規化し、picomatch が扱える形にする。 */
export function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/** root からの相対パス (posix 形式) を返す。 */
export function relPosix(rootAbs: string, abs: string): string {
  return toPosix(relative(rootAbs, abs));
}

/** glob 群のいずれかにマッチするか判定する matcher を作る。 */
export function makeMatcher(globs: string[]): (relPath: string) => boolean {
  if (globs.length === 0) return () => false;
  const matchers = globs.map((g) => picomatch(g, { dot: true }));
  return (relPath: string) => {
    const p = toPosix(relPath);
    return matchers.some((m) => m(p));
  };
}

/** 単一 glob の matcher。 */
export function matchesGlob(glob: string, relPath: string): boolean {
  return picomatch(glob, { dot: true })(toPosix(relPath));
}
