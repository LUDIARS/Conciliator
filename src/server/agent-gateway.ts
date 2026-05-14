import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import { eventBus, type EventSource } from "../events.js";
import { stageContent } from "../claims/snapshots.js";
import { CernereClient } from "../cernere/client.js";
import { logger } from "../shared/logger.js";
import { nowSec } from "../shared/ids.js";
import type { AgentToServer, ServerToAgent } from "../agent/protocol.js";

interface AgentConn {
  ws: WebSocket;
  agentId: string;
  cernereUserId: string;
  host: string;
  label: string;
}

/**
 * server モード: 遠隔 agent からの WS 接続を受け、Cernere project-token を検証し、
 * agent のファイル / ロックイベントをローカル eventBus に再注入する。
 * 注入イベントには source={kind:"agent",...} を付け、orchestrator が Cernere user を
 * 作業者 identity として扱えるようにする。
 */
export function attachAgentGateway(server: Server, cernere: CernereClient): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/agent" });
  const conns = new Set<AgentConn>();

  // server が出す通知を全 agent にも転送する (agent 側でデスクトップ通知)
  eventBus.on("notify", (e) => {
    const msg: ServerToAgent = { type: "notify", notification: e.notification };
    for (const c of conns) {
      if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
    }
  });

  wss.on("connection", (ws) => {
    let conn: AgentConn | null = null;

    ws.on("message", (raw) => {
      let msg: AgentToServer;
      try {
        msg = JSON.parse(raw.toString()) as AgentToServer;
      } catch {
        return;
      }

      // 最初のメッセージは必ず agent.hello (認証)
      if (!conn) {
        if (msg.type !== "agent.hello") {
          send(ws, { type: "agent.error", message: "expected agent.hello" });
          ws.close();
          return;
        }
        try {
          const payload = cernere.verify(msg.token);
          conn = {
            ws,
            agentId: msg.agentId,
            cernereUserId: payload.sub,
            host: msg.host,
            label: typeof payload.label === "string" ? payload.label : payload.sub,
          };
          conns.add(conn);
          send(ws, { type: "agent.welcome", cernereUserId: payload.sub });
          eventBus.emit({
            type: "agent.connected",
            agentId: conn.agentId,
            cernereUserId: conn.cernereUserId,
            host: conn.host,
            ts: nowSec(),
          });
          logger.info(
            { agentId: conn.agentId, cernereUser: conn.cernereUserId, host: conn.host },
            "agent connected",
          );
        } catch (err) {
          send(ws, { type: "agent.error", message: `auth failed: ${String(err)}` });
          logger.warn({ err }, "agent auth failed");
          ws.close();
        }
        return;
      }

      // 認証済み — イベントを eventBus に再注入
      const source: EventSource = {
        kind: "agent",
        agentId: conn.agentId,
        cernereUserId: conn.cernereUserId,
        host: conn.host,
        label: conn.label,
      };

      switch (msg.type) {
        case "agent.snapshot":
          stageContent(msg.path, Buffer.from(msg.contentBase64, "base64"));
          break;
        case "file.changed":
          eventBus.emit({
            type: "file.changed",
            rootId: msg.rootId,
            path: msg.path,
            kind: msg.kind,
            ts: msg.ts,
            sizeBytes: msg.sizeBytes,
            hash: msg.hash,
            source,
          });
          break;
        case "lockfile.opened":
          eventBus.emit({
            type: "lockfile.opened",
            rootId: msg.rootId,
            targetPath: msg.targetPath,
            lockPath: msg.lockPath,
            owner: msg.owner,
            ts: msg.ts,
            source,
          });
          break;
        case "lockfile.closed":
          eventBus.emit({
            type: "lockfile.closed",
            rootId: msg.rootId,
            targetPath: msg.targetPath,
            lockPath: msg.lockPath,
            ts: msg.ts,
            source,
          });
          break;
        default:
          break;
      }
    });

    const cleanup = () => {
      if (conn) {
        conns.delete(conn);
        eventBus.emit({ type: "agent.disconnected", agentId: conn.agentId, ts: nowSec() });
        logger.info({ agentId: conn.agentId }, "agent disconnected");
      }
    };
    ws.on("close", cleanup);
    ws.on("error", cleanup);
  });

  logger.info("agent gateway listening on /agent");
  return wss;
}

function send(ws: WebSocket, msg: ServerToAgent): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
