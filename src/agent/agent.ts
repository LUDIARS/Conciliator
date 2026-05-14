import { WebSocket } from "ws";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import nodeNotifier from "node-notifier";
import { eventBus } from "../events.js";
import { Watcher, safeStatSize } from "../watcher/watcher.js";
import { CernereClient } from "../cernere/client.js";
import { getConfig } from "../config/loader.js";
import { logger } from "../shared/logger.js";
import type { AgentToServer, ServerToAgent } from "./protocol.js";

/**
 * agent モード: 個人 PC 上で動き、ローカルの作業領域を監視して
 * Cernere 認証付きで server へイベントを転送する。
 *
 * 認証: 対話ログイン済みの accessToken (env) → Cernere `/api/auth/project-token` で
 * per-project token を取得 → server の /agent に提示。tailnet 越しの接続を想定。
 */
export async function runAgent(): Promise<void> {
  const config = getConfig();
  if (config.mode !== "agent" || !config.agent || !config.cernere) {
    throw new Error("agent モードの設定が不足しています (mode / agent / cernere)");
  }
  const agentCfg = config.agent;
  const accessToken = process.env[agentCfg.accessTokenEnv];
  if (!accessToken) {
    throw new Error(
      `Cernere accessToken 未設定: 環境変数 ${agentCfg.accessTokenEnv} に対話ログイン済みトークンを設定してください`,
    );
  }

  const cernere = new CernereClient(config.cernere);
  const projectToken = await cernere.getProjectToken(accessToken);
  const agentId = agentCfg.agentId ?? `agent-${hostname()}`;
  const maxBytes = config.claim.snapshotMaxBytes;

  // ローカル監視を開始 (eventBus に流れる)
  const watcher = new Watcher();
  watcher.start();

  let ws: WebSocket | null = null;
  let backoff = 1000;

  const sendMsg = (m: AgentToServer): void => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  };

  const connect = (): void => {
    const url = agentCfg.serverUrl.replace(/\/$/, "") + "/agent";
    const sock = new WebSocket(url);
    ws = sock;

    sock.on("open", () => {
      backoff = 1000;
      sendMsg({ type: "agent.hello", token: projectToken, agentId, host: hostname() });
      logger.info({ url }, "agent connected to server");
    });
    sock.on("message", (raw) => {
      let msg: ServerToAgent;
      try {
        msg = JSON.parse(raw.toString()) as ServerToAgent;
      } catch {
        return;
      }
      if (msg.type === "agent.welcome") {
        logger.info({ cernereUser: msg.cernereUserId }, "agent authenticated");
      } else if (msg.type === "agent.error") {
        logger.error({ message: msg.message }, "agent rejected by server");
      } else if (msg.type === "notify") {
        try {
          nodeNotifier.notify({
            title: `Conciliator — ${msg.notification.title}`,
            message: msg.notification.body,
            wait: false,
          });
        } catch (err) {
          logger.warn({ err }, "desktop notification failed");
        }
      }
    });
    sock.on("close", () => {
      logger.warn({ backoffMs: backoff }, "agent disconnected — reconnecting");
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 30_000);
    });
    sock.on("error", (err) => {
      logger.warn({ err }, "agent ws error");
      sock.close();
    });
  };

  // ローカルイベントを server へ転送
  eventBus.on("file.changed", (e) => {
    sendMsg({
      type: "file.changed",
      rootId: e.rootId,
      path: e.path,
      kind: e.kind,
      ts: e.ts,
      sizeBytes: e.sizeBytes,
      hash: e.hash,
    });
  });
  eventBus.on("lockfile.opened", (e) => {
    // baseline スナップショットを先にアップロード (実体は agent 側にしか無いため)
    const size = safeStatSize(e.targetPath);
    if (size != null && size <= maxBytes) {
      try {
        const content = readFileSync(e.targetPath);
        sendMsg({
          type: "agent.snapshot",
          path: e.targetPath,
          contentBase64: content.toString("base64"),
        });
      } catch (err) {
        logger.warn({ err, path: e.targetPath }, "agent snapshot read failed");
      }
    }
    sendMsg({
      type: "lockfile.opened",
      rootId: e.rootId,
      targetPath: e.targetPath,
      lockPath: e.lockPath,
      owner: e.owner,
      ts: e.ts,
    });
  });
  eventBus.on("lockfile.closed", (e) => {
    sendMsg({
      type: "lockfile.closed",
      rootId: e.rootId,
      targetPath: e.targetPath,
      lockPath: e.lockPath,
      ts: e.ts,
    });
  });

  connect();

  const shutdown = (): void => {
    void watcher.stop();
    ws?.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  logger.info({ agentId, server: agentCfg.serverUrl }, "conciliator agent running");
}
