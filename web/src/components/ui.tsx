import type { ReactNode } from "react";
import type { Severity, TriageStatus } from "../lib/types";

export function Card({ children }: { children: ReactNode }) {
  return <div className="card">{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

const SEVERITY_CLASS: Record<Severity, string> = {
  low: "muted",
  medium: "warn",
  high: "danger",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`badge ${SEVERITY_CLASS[severity]}`}>{severity}</span>;
}

const STATUS_CLASS: Record<string, string> = {
  open: "danger",
  ack: "warn",
  resolved: "ok",
  dismissed: "muted",
  active: "accent",
  stale: "warn",
  released: "muted",
  pre: "warn",
  manifest: "danger",
};

export function StatusBadge({ value }: { value: string }) {
  return <span className={`badge ${STATUS_CLASS[value] ?? "muted"}`}>{value}</span>;
}

export function TriageButtons({
  status,
  onTriage,
}: {
  status: TriageStatus;
  onTriage: (s: TriageStatus) => void;
}) {
  if (status === "resolved" || status === "dismissed") {
    return <StatusBadge value={status} />;
  }
  return (
    <div className="row">
      {status === "open" && (
        <button className="btn" onClick={() => onTriage("ack")}>
          確認
        </button>
      )}
      <button className="btn primary" onClick={() => onTriage("resolved")}>
        解決
      </button>
      <button className="btn" onClick={() => onTriage("dismissed")}>
        却下
      </button>
    </div>
  );
}
