import { useState } from "react";
import { api } from "../lib/api";
import { useLiveQuery } from "../lib/useLive";
import { Card, Empty, StatusBadge, TriageButtons } from "../components/ui";
import { baseName, relTime } from "../lib/format";
import type { Collision, TriageStatus, XlsxDiffResponse } from "../lib/types";

const REFRESH = ["collision.detected", "collision.updated"];

export function Collisions() {
  const { data, reload } = useLiveQuery(() => api.collisions(), REFRESH);
  const collisions = data?.collisions ?? [];

  return (
    <>
      <h1 className="page-title">衝突</h1>
      <p className="page-sub">
        pre = 事前検知 (まだ止まれる) / manifest = 顕在化 (両者が保存済)
      </p>
      {collisions.length === 0 ? (
        <Card>
          <Empty>衝突は検知されていません</Empty>
        </Card>
      ) : (
        collisions.map((c) => (
          <CollisionCard key={c.id} collision={c} onChange={reload} />
        ))
      )}
    </>
  );
}

function CollisionCard({
  collision,
  onChange,
}: {
  collision: Collision;
  onChange: () => void;
}) {
  const [diff, setDiff] = useState<XlsxDiffResponse | null>(null);
  const [diffErr, setDiffErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const triage = async (status: TriageStatus) => {
    await api.triageCollision(collision.id, status);
    onChange();
  };

  const loadDiff = async () => {
    setLoading(true);
    setDiffErr(null);
    try {
      setDiff(await api.collisionDiff(collision.id));
    } catch (e) {
      setDiffErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <span className="mono" style={{ fontWeight: 700, fontSize: 15 }}>
            {baseName(collision.path)}
          </span>{" "}
          <StatusBadge value={collision.phase} />{" "}
          <StatusBadge value={collision.status} />
        </div>
        <span className="muted">{relTime(collision.detected_at)}</span>
      </div>
      <div className="mono muted" style={{ fontSize: 12, margin: "4px 0 10px" }}>
        {collision.path}
      </div>

      <table style={{ marginBottom: 10 }}>
        <tbody>
          <tr>
            <td style={{ width: 90 }} className="muted">
              先行作業者
            </td>
            <td>
              {collision.claimADetail?.worker ?? "—"}
              {collision.claimADetail?.intent && (
                <span className="muted"> — {collision.claimADetail.intent}</span>
              )}
            </td>
          </tr>
          <tr>
            <td className="muted">後発作業者</td>
            <td>
              {collision.claimBDetail?.worker ?? "—"}
              {collision.claimBDetail?.intent && (
                <span className="muted"> — {collision.claimBDetail.intent}</span>
              )}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="row">
        <TriageButtons status={collision.status} onTriage={triage} />
        <button className="btn" disabled={loading} onClick={loadDiff}>
          {loading ? "読込中…" : "クレバーマージ差分を見る"}
        </button>
      </div>

      {diffErr && (
        <div style={{ color: "var(--warn)", marginTop: 10, fontSize: 12.5 }}>
          差分を取得できません: {diffErr}
        </div>
      )}
      {diff && <DiffView diff={diff} />}
    </Card>
  );
}

function DiffView({ diff }: { diff: XlsxDiffResponse }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        baseline: {diff.legend.baseline} ／ A: {diff.legend.a} ／ B: {diff.legend.b}
        <br />
        変更セル {diff.diff.summary.changedCells} / うち競合{" "}
        <span style={{ color: "var(--danger)" }}>{diff.diff.summary.conflictCells}</span>
      </div>
      {diff.diff.sheets.length === 0 && <Empty>3 バージョン間に差分はありません</Empty>}
      {diff.diff.sheets.map((sheet) => (
        <div key={sheet.name} style={{ marginBottom: 14 }}>
          <h4 style={{ margin: "8px 0 4px" }}>
            シート: {sheet.name}{" "}
            {sheet.conflictCount > 0 && (
              <span className="badge danger">競合 {sheet.conflictCount}</span>
            )}
          </h4>
          <table>
            <thead>
              <tr>
                <th>セル</th>
                <th>baseline</th>
                <th>A</th>
                <th>B</th>
              </tr>
            </thead>
            <tbody>
              {sheet.cells.map((cell) => (
                <tr key={cell.ref} className={`diff-cell ${cell.conflict ? "conflict" : ""}`}>
                  <td className="mono">
                    {cell.ref} {cell.conflict && <span className="badge danger">競合</span>}
                  </td>
                  <td className="diff-cell">{cell.baseline ?? <i className="muted">∅</i>}</td>
                  <td className="diff-cell">
                    <span className={`v ${cell.changedByA ? "changed" : ""}`}>
                      {cell.a ?? <i className="muted">∅</i>}
                    </span>
                  </td>
                  <td className="diff-cell">
                    <span className={`v ${cell.changedByB ? "changed" : ""}`}>
                      {cell.b ?? <i className="muted">∅</i>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <div className="muted" style={{ fontSize: 11.5 }}>
        v0.1 は差分の提示まで。マージ結果の適用は手作業で行ってください。
      </div>
    </div>
  );
}
