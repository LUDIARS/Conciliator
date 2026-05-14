import type {
  Claim,
  Collision,
  FileEvent,
  Overview,
  RiskAlert,
  StructureViolation,
  WatchRoot,
  XlsxDiffResponse,
} from "./types";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return (await res.json()) as T;
}

async function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error((detail as { error?: string }).error ?? `${res.status} ${path}`);
  }
  return (await res.json()) as T;
}

export const api = {
  overview: () => get<Overview>("/api/v1/overview"),
  watchRoots: () => get<{ roots: WatchRoot[] }>("/api/v1/watch-roots"),
  fileEvents: (limit = 60) => get<{ events: FileEvent[] }>(`/api/v1/file-events?limit=${limit}`),

  claims: (status?: string) =>
    get<{ claims: Claim[] }>(`/api/v1/claims${status ? `?status=${status}` : ""}`),
  declareClaim: (body: {
    rootId: string;
    path: string;
    label: string;
    intentText?: string;
  }) => send<{ claim: Claim }>("/api/v1/claims", "POST", body),
  releaseClaim: (id: string) =>
    send<{ claim: Claim }>(`/api/v1/claims/${id}`, "PATCH", { action: "release" }),
  setIntent: (id: string, intentText: string) =>
    send<{ claim: Claim }>(`/api/v1/claims/${id}/intent`, "POST", { intentText }),

  collisions: (status?: string) =>
    get<{ collisions: Collision[] }>(
      `/api/v1/collisions${status ? `?status=${status}` : ""}`,
    ),
  triageCollision: (id: string, status: string) =>
    send<{ collision: Collision }>(`/api/v1/collisions/${id}`, "PATCH", { status }),
  collisionDiff: (id: string) => get<XlsxDiffResponse>(`/api/v1/collisions/${id}/diff`),

  structureViolations: (status?: string) =>
    get<{ violations: StructureViolation[] }>(
      `/api/v1/structure/violations${status ? `?status=${status}` : ""}`,
    ),
  triageViolation: (id: string, status: string) =>
    send<{ violation: StructureViolation }>(
      `/api/v1/structure/violations/${id}`,
      "PATCH",
      { status },
    ),

  riskAlerts: (status?: string) =>
    get<{ alerts: RiskAlert[] }>(`/api/v1/risk/alerts${status ? `?status=${status}` : ""}`),
  triageAlert: (id: string, status: string) =>
    send<{ alert: RiskAlert }>(`/api/v1/risk/alerts/${id}`, "PATCH", { status }),
  riskRules: () =>
    get<{ rules: { id: string; enabled: boolean; source: string; rule: unknown }[] }>(
      "/api/v1/risk/rules",
    ),
};
