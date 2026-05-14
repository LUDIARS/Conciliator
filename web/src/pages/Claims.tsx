import { useState } from "react";
import { api } from "../lib/api";
import { useLiveQuery } from "../lib/useLive";
import { Card, Empty, StatusBadge } from "../components/ui";
import { baseName, relTime } from "../lib/format";
import type { Claim } from "../lib/types";

const REFRESH = ["claim.created", "claim.updated", "claim.released"];

export function Claims() {
  const { data, reload } = useLiveQuery(() => api.claims(), REFRESH);
  const claims = data?.claims ?? [];

  return (
    <>
      <h1 className="page-title">作業クレーム</h1>
      <p className="page-sub">「誰が・どのパスを・何の目的で」触っているかの宣言</p>

      <DeclareForm onDone={reload} />

      <Card>
        {claims.length === 0 ? (
          <Empty>クレームはありません</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>状態</th>
                <th>作業者</th>
                <th>ファイル</th>
                <th>由来</th>
                <th>意図</th>
                <th>更新</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <ClaimRow key={c.id} claim={c} onChange={reload} />
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

function ClaimRow({ claim, onChange }: { claim: Claim; onChange: () => void }) {
  const [intent, setIntent] = useState("");
  const [busy, setBusy] = useState(false);

  const submitIntent = async () => {
    if (!intent.trim()) return;
    setBusy(true);
    try {
      await api.setIntent(claim.id, intent.trim());
      setIntent("");
      onChange();
    } finally {
      setBusy(false);
    }
  };

  const release = async () => {
    setBusy(true);
    try {
      await api.releaseClaim(claim.id);
      onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr>
      <td>
        <StatusBadge value={claim.status} />
      </td>
      <td>
        {claim.worker?.label ?? "—"}
        <div className="muted mono" style={{ fontSize: 11 }}>
          {claim.worker?.host}
        </div>
      </td>
      <td className="mono">{baseName(claim.path)}</td>
      <td>
        <span className={`badge ${claim.origin === "declared" ? "accent" : "muted"}`}>
          {claim.origin === "declared" ? "宣言" : "推測"}
        </span>
      </td>
      <td>
        {claim.intent_text ? (
          claim.intent_text
        ) : claim.status === "active" ? (
          <div className="row foundation-form" style={{ maxWidth: 260 }}>
            <input
              type="text"
              placeholder="何をしていますか？"
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitIntent()}
            />
            <button className="btn" disabled={busy} onClick={submitIntent}>
              記録
            </button>
          </div>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td className="muted">{relTime(claim.updated_at)}</td>
      <td>
        {claim.status === "active" && (
          <button className="btn" disabled={busy} onClick={release}>
            release
          </button>
        )}
      </td>
    </tr>
  );
}

function DeclareForm({ onDone }: { onDone: () => void }) {
  const { data: roots } = useLiveQuery(api.watchRoots, ["config.reloaded"]);
  const [rootId, setRootId] = useState("");
  const [path, setPath] = useState("");
  const [label, setLabel] = useState("");
  const [intentText, setIntentText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!rootId || !path.trim() || !label.trim()) {
      setErr("ルート / パス / 作業者名 は必須です");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.declareClaim({
        rootId,
        path: path.trim(),
        label: label.trim(),
        intentText: intentText.trim() || undefined,
      });
      setPath("");
      setIntentText("");
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>クレームを宣言</h3>
      <div className="foundation-form row" style={{ flexWrap: "wrap" }}>
        <select value={rootId} onChange={(e) => setRootId(e.target.value)} style={{ maxWidth: 180 }}>
          <option value="">ルート選択…</option>
          {roots?.roots.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="絶対パス (例 E:/.../budget.xlsx)"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          style={{ maxWidth: 320 }}
        />
        <input
          type="text"
          placeholder="作業者名"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          style={{ maxWidth: 160 }}
        />
        <input
          type="text"
          placeholder="意図 (任意)"
          value={intentText}
          onChange={(e) => setIntentText(e.target.value)}
          style={{ maxWidth: 260 }}
        />
        <button className="btn primary" disabled={busy} onClick={submit}>
          宣言
        </button>
      </div>
      {err && (
        <div style={{ color: "var(--danger)", marginTop: 8, fontSize: 12.5 }}>{err}</div>
      )}
    </Card>
  );
}
