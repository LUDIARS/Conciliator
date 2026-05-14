import { api } from "../lib/api";
import { useLiveQuery } from "../lib/useLive";
import { Card, Empty, SeverityBadge, StatusBadge, TriageButtons } from "../components/ui";
import { baseName, relTime } from "../lib/format";
import type { TriageStatus } from "../lib/types";

export function Risk() {
  const { data: alertData, reload } = useLiveQuery(() => api.riskAlerts(), ["risk.alerted"]);
  const { data: ruleData } = useLiveQuery(api.riskRules, ["config.reloaded"]);
  const alerts = alertData?.alerts ?? [];
  const rules = ruleData?.rules ?? [];

  const triage = async (id: string, status: TriageStatus) => {
    await api.triageAlert(id, status);
    reload();
  };

  return (
    <>
      <h1 className="page-title">リスク監視</h1>
      <p className="page-sub">危険な操作・脆弱性のパターン検知</p>

      <Card>
        <h3 style={{ marginTop: 0 }}>アラート</h3>
        {alerts.length === 0 ? (
          <Empty>リスクアラートはありません</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>状態</th>
                <th>深刻度</th>
                <th>ルール</th>
                <th>内容</th>
                <th>対象</th>
                <th>検知</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id}>
                  <td>
                    <StatusBadge value={a.status} />
                  </td>
                  <td>
                    <SeverityBadge severity={a.severity} />
                  </td>
                  <td className="mono">{a.rule_id}</td>
                  <td>{a.detail}</td>
                  <td className="mono">{baseName(a.path)}</td>
                  <td className="muted">{relTime(a.detected_at)}</td>
                  <td>
                    <TriageButtons status={a.status} onTriage={(s) => triage(a.id, s)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <h3 style={{ marginTop: 0 }}>ルール</h3>
        {rules.length === 0 ? (
          <Empty>ルールがありません</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>由来</th>
                <th>有効</th>
                <th>定義</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.id}</td>
                  <td>
                    <span className={`badge ${r.source === "config" ? "accent" : "muted"}`}>
                      {r.source}
                    </span>
                  </td>
                  <td>{r.enabled ? "✓" : "—"}</td>
                  <td className="mono muted" style={{ fontSize: 11.5 }}>
                    {JSON.stringify(r.rule)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
