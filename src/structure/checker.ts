import { existsSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { structureRepo } from "../db/repos.js";
import { eventBus } from "../events.js";
import { getResolvedRoots, type ResolvedWatchRoot } from "../config/loader.js";
import { logger } from "../shared/logger.js";
import { makeMatcher, matchesGlob, relPosix } from "../shared/glob.js";

/**
 * 構成検証。監視ルートが宣言された構成ルールに従っているかを照合する。
 * - forbidGlobs: 存在してはいけない glob にマッチしたら違反
 * - namingRules: glob にマッチするファイルの basename が pattern に従わなければ違反
 * - requireDirs: ルート直下に必須ディレクトリが無ければ違反 (ルートスキャン時)
 */
export class StructureChecker {
  /** ファイル単位の検証 (add / change 時)。 */
  checkPath(rootId: string, absPath: string): void {
    const root = getResolvedRoots().find((r) => r.id === rootId);
    if (!root) return;
    const rel = relPosix(root.absPath, absPath);

    // forbidGlobs
    const forbidden = makeMatcher(root.structure.forbidGlobs);
    if (forbidden(rel)) {
      this.raise(rootId, absPath, "forbid", `禁止パターンに一致するファイルが存在します: ${rel}`);
      return;
    }

    // namingRules
    for (const rule of root.structure.namingRules) {
      if (!matchesGlob(rule.glob, rel)) continue;
      let re: RegExp;
      try {
        re = new RegExp(rule.pattern);
      } catch (err) {
        logger.warn({ err, pattern: rule.pattern }, "invalid naming rule pattern");
        continue;
      }
      if (!re.test(basename(absPath))) {
        this.raise(
          rootId,
          absPath,
          `naming:${rule.glob}`,
          `命名規約に違反しています (期待: /${rule.pattern}/): ${rel}`,
        );
      }
    }
  }

  /** ルート単位の検証 (起動時 + config reload 時)。requireDirs の存在を確認する。 */
  checkRoots(): void {
    for (const root of getResolvedRoots()) {
      this.checkRequireDirs(root);
    }
  }

  private checkRequireDirs(root: ResolvedWatchRoot): void {
    for (const dir of root.structure.requireDirs) {
      const abs = join(root.absPath, dir);
      const ok = existsSync(abs) && statSync(abs).isDirectory();
      if (!ok) {
        this.raise(root.id, abs, `require-dir:${dir}`, `必須ディレクトリがありません: ${dir}`);
      }
    }
  }

  private raise(rootId: string, path: string, ruleId: string, detail: string): void {
    if (structureRepo.hasOpen(rootId, path, ruleId)) return;
    const violation = structureRepo.insert({ rootId, path, ruleId, detail });
    logger.warn({ violation: violation.id, ruleId, path }, "structure violation");
    eventBus.emit({ type: "structure.violated", violation });
  }
}

export const structureChecker = new StructureChecker();
