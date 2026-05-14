import { useEffect, useState } from "react";
import { wsClient } from "./lib/ws";
import { useLiveQuery, useWsStatus } from "./lib/useLive";
import { api } from "./lib/api";
import type { Notification } from "./lib/types";
import { Monitor } from "./pages/Monitor";
import { Claims } from "./pages/Claims";
import { Collisions } from "./pages/Collisions";
import { Structure } from "./pages/Structure";
import { Risk } from "./pages/Risk";

type PageId = "monitor" | "claims" | "collisions" | "structure" | "risk";

const PAGES: { id: PageId; label: string }[] = [
  { id: "monitor", label: "モニタ" },
  { id: "claims", label: "作業クレーム" },
  { id: "collisions", label: "衝突" },
  { id: "structure", label: "構成検証" },
  { id: "risk", label: "リスク監視" },
];

export function App() {
  const [page, setPage] = useState<PageId>("monitor");
  const [toasts, setToasts] = useState<Notification[]>([]);
  const wsUp = useWsStatus();
  const { data: overview } = useLiveQuery(api.overview, []);

  useEffect(() => {
    return wsClient.on((event: { type?: string; notification?: Notification }) => {
      if (event.type === "notify" && event.notification) {
        const n = event.notification;
        setToasts((prev) => [...prev, n].slice(-5));
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== n.id));
        }, 9000);
      }
    });
  }, []);

  const counts: Record<PageId, number | null> = {
    monitor: null,
    claims: overview?.claims.active ?? null,
    collisions: overview?.collisions.open ?? null,
    structure: overview?.structureViolations.open ?? null,
    risk: overview?.riskAlerts.open ?? null,
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          Conciliator
          <small>作業衝突の検知・予防・マージ支援</small>
        </div>
        <nav className="nav">
          {PAGES.map((p) => (
            <button
              key={p.id}
              className={page === p.id ? "active" : ""}
              onClick={() => setPage(p.id)}
            >
              {p.label}
              {counts[p.id] != null && counts[p.id]! > 0 && (
                <span className="count">{counts[p.id]}</span>
              )}
            </button>
          ))}
        </nav>
        <div style={{ padding: "16px 10px", fontSize: 12 }} className="muted">
          <span className={`ws-dot ${wsUp ? "up" : "down"}`} />
          {wsUp ? "ライブ接続中" : "切断 — 再接続中"}
        </div>
      </aside>

      <main className="main">
        {page === "monitor" && <Monitor />}
        {page === "claims" && <Claims />}
        {page === "collisions" && <Collisions />}
        {page === "structure" && <Structure />}
        {page === "risk" && <Risk />}
      </main>

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.severity}`}>
            <div className="t-title">{t.title}</div>
            <div className="t-body">{t.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
