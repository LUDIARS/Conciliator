import { api } from "../lib/api";
import { useLiveQuery } from "../lib/useLive";
import { Card, Empty, StatusBadge, TriageButtons } from "../components/ui";
import { relTime } from "../lib/format";
import type { TriageStatus } from "../lib/types";

export function Structure() {
  const { data, reload } = useLiveQuery(
    () => api.structureViolations(),
    ["structure.violated"],
  );
  const violations = data?.violations ?? [];

  const triage = async (id: string, status: TriageStatus) => {
    await api.triageViolation(id, status);
    reload();
  };

  return (
    <>
      <h1 className="page-title">構成検証</h1>
      <p className="page-sub">監視ルートが宣言された構成ルールに従っているか</p>
      <Card>
        {violations.length === 0 ? (
          <Empty>構成違反はありません</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>状態</th>
                <th>ルート</th>
                <th>ルール</th>
                <th>内容</th>
                <th>検知</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {violations.map((v) => (
                <tr key={v.id}>
                  <td>
                    <StatusBadge value={v.status} />
                  </td>
                  <td className="muted">{v.root_id}</td>
                  <td className="mono">{v.rule_id}</td>
                  <td>{v.detail}</td>
                  <td className="muted">{relTime(v.detected_at)}</td>
                  <td>
                    <TriageButtons status={v.status} onTriage={(s) => triage(v.id, s)} />
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
