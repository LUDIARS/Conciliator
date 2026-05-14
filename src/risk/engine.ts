import { readFileSync } from "node:fs";
import { fileEventsRepo, riskAlertsRepo, riskRulesRepo } from "../db/repos.js";
import { eventBus } from "../events.js";
import { getConfig, getResolvedRoots } from "../config/loader.js";
import { riskRuleSchema, type RiskRuleConfig } from "../shared/config-types.js";
import { logger } from "../shared/logger.js";
import { nowSec } from "../shared/ids.js";
import type { FileEventRow, RiskAlertRow } from "../shared/types.js";
import { isUnderRoot } from "../watcher/watcher.js";

/** content ルールで内容を読む上限サイズ。 */
const CONTENT_SCAN_MAX_BYTES = 1024 * 1024;

/**
 * リスク監視エンジン。ファイルイベント列にパターンルールを適用し、
 * 危険操作 (大量削除 / 秘密混入 / 領域外書込 等) を risk_alert として起票する。
 */
export class RiskEngine {
  /** config の riskRules を DB に同期する (起動時 + config reload 時)。 */
  syncFromConfig(): void {
    const rules = getConfig().riskRules;
    riskRulesRepo.replaceConfigRules(
      rules.map((r) => ({ id: r.id, ruleJson: JSON.stringify(r) })),
    );
    logger.info({ count: rules.length }, "risk rules synced from config");
  }

  /** 永続化されたファイルイベントにルールを適用する。 */
  onFilePersisted(row: FileEventRow): void {
    for (const ruleRow of riskRulesRepo.listEnabled()) {
      let rule: RiskRuleConfig;
      try {
        rule = riskRuleSchema.parse(JSON.parse(ruleRow.rule_json));
      } catch (err) {
        logger.warn({ err, ruleId: ruleRow.id }, "skipping malformed risk rule");
        continue;
      }
      try {
        this.evaluate(rule, row);
      } catch (err) {
        logger.warn({ err, ruleId: rule.id }, "risk rule evaluation failed");
      }
    }
  }

  private evaluate(rule: RiskRuleConfig, row: FileEventRow): void {
    if (rule.kind === "count") {
      if (row.kind !== rule.event) return;
      const since = nowSec() - rule.windowSec;
      if (this.hasRecentAlert(rule.id, row.root_id, rule.windowSec)) return;
      const count = fileEventsRepo.countRecent(row.root_id, rule.event, since);
      if (count >= rule.threshold) {
        this.raise(
          rule.id,
          row.root_id,
          row.path,
          rule.severity,
          `${rule.windowSec}秒間に ${rule.event} が ${count} 件 (閾値 ${rule.threshold})`,
        );
      }
      return;
    }

    if (rule.kind === "content") {
      if (row.kind !== rule.on) return;
      if (this.hasOpenAlert(rule.id, row.path)) return;
      let content: string;
      try {
        const buf = readFileSync(row.path);
        if (buf.length > CONTENT_SCAN_MAX_BYTES) return;
        content = buf.toString("utf8");
      } catch {
        return;
      }
      let re: RegExp;
      try {
        re = new RegExp(rule.match, "i");
      } catch (err) {
        logger.warn({ err, ruleId: rule.id }, "invalid content rule regex");
        return;
      }
      if (re.test(content)) {
        this.raise(
          rule.id,
          row.root_id,
          row.path,
          rule.severity,
          `秘密情報らしきパターンを検出 (/${rule.match}/i)`,
        );
      }
      return;
    }

    if (rule.kind === "path" && rule.match === "outsideWatchRoot") {
      const inside = getResolvedRoots().some((r) => isUnderRoot(r, row.path));
      if (!inside && !this.hasOpenAlert(rule.id, row.path)) {
        this.raise(
          rule.id,
          row.root_id,
          row.path,
          rule.severity,
          `監視ルート外への書き込み: ${row.path}`,
        );
      }
    }
  }

  private hasOpenAlert(ruleId: string, path: string): boolean {
    return riskAlertsRepo
      .list("open")
      .some((a) => a.rule_id === ruleId && a.path === path);
  }

  private hasRecentAlert(ruleId: string, rootId: string, windowSec: number): boolean {
    const since = nowSec() - windowSec;
    return riskAlertsRepo
      .list()
      .some(
        (a) =>
          a.rule_id === ruleId &&
          a.root_id === rootId &&
          a.detected_at >= since &&
          (a.status === "open" || a.status === "ack"),
      );
  }

  private raise(
    ruleId: string,
    rootId: string | null,
    path: string,
    severity: RiskAlertRow["severity"],
    detail: string,
  ): void {
    const alert = riskAlertsRepo.insert({ ruleId, rootId, path, severity, detail });
    logger.warn({ alert: alert.id, ruleId, path }, "risk alert raised");
    eventBus.emit({ type: "risk.alerted", alert });
  }
}

export const riskEngine = new RiskEngine();
