import { api } from "../lib/api";
import { useLiveQuery } from "../lib/useLive";
import { Card, Empty, StatusBadge } from "../components/ui";
import { baseName, relTime } from "../lib/format";

const REFRESH = [
  "file.persisted",
  "claim.created",
  "claim.updated",
  "claim.released",
  "collision.detected",
  "collision.updated",
  "structure.violated",
  "risk.alerted",
  "config.reloaded",
];

export function Monitor() {
  const { data: overview } = useLiveQuery(api.overview, REFRESH);
  const { data: roots } = useLiveQuery(api.watchRoots, ["config.reloaded", "file.persisted"]);
  const { data: events } = useLiveQuery(() => api.fileEvents(40), ["file.persisted"]);

  return (
    <>
      <h1 className="page-title">モニタ</h1>
      <p className="page-sub">監視状況のスナップショット</p>

      <Card>
        <div className="grid">
          <Stat k="監視ルート" v={overview?.watchRoots ?? "—"} />
          <Stat k="作業者" v={overview?.workers ?? "—"} />
          <Stat k="アクティブ claim" v={overview?.claims.active ?? "—"} />
          <Stat
            k="衝突 (未解決)"
            v={overview?.collisions.open ?? "—"}
            danger={(overview?.collisions.open ?? 0) > 0}
          />
          <Stat
            k="うち顕在化"
            v={overview?.collisions.manifest ?? "—"}
            danger={(overview?.collisions.manifest ?? 0) > 0}
          />
          <Stat
            k="構成違反"
            v={overview?.structureViolations.open ?? "—"}
            warn={(overview?.structureViolations.open ?? 0) > 0}
          />
          <Stat
            k="リスク alert"
            v={overview?.riskAlerts.open ?? "—"}
            danger={(overview?.riskAlerts.high ?? 0) > 0}
          />
        </div>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0 }}>監視ルート</h3>
        {!roots?.roots.length ? (
          <Empty>監視ルートがありません</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>ラベル</th>
                <th>パス</th>
                <th>24h イベント</th>
              </tr>
            </thead>
            <tbody>
              {roots.roots.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.id}</td>
                  <td>{r.label}</td>
                  <td className="mono muted">{r.path}</td>
                  <td>{r.recentEventCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <h3 style={{ marginTop: 0 }}>最近のファイルイベント</h3>
        {!events?.events.length ? (
          <Empty>イベントはまだありません</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>種別</th>
                <th>ファイル</th>
                <th>ルート</th>
                <th>時刻</th>
              </tr>
            </thead>
            <tbody>
              {events.events.map((e) => (
                <tr key={e.id}>
                  <td>
                    <StatusBadge value={e.kind} />
                  </td>
                  <td className="mono">{baseName(e.path)}</td>
                  <td className="muted">{e.root_id}</td>
                  <td className="muted">{relTime(e.ts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

function Stat({
  k,
  v,
  danger,
  warn,
}: {
  k: string;
  v: number | string;
  danger?: boolean;
  warn?: boolean;
}) {
  const color = danger ? "var(--danger)" : warn ? "var(--warn)" : "var(--text)";
  return (
    <div className="stat">
      <div className="v" style={{ color }}>
        {v}
      </div>
      <div className="k">{k}</div>
    </div>
  );
}
