import { serve } from "@hono/node-server";
import { WebSocketServer, WebSocket } from "ws";
import { createApp } from "./app.js";
import { openDb, closeDb } from "./db/index.js";
import { loadConfig, getConfig } from "./config/loader.js";
import { eventBus } from "./events.js";
import { startOrchestrator } from "./orchestrator.js";
import { Watcher } from "./watcher/watcher.js";
import { riskEngine } from "./risk/engine.js";
import { structureChecker } from "./structure/checker.js";
import { Notifier, WsChannel, DesktopChannel, type NotificationChannel } from "./notify/notifier.js";
import { ConcordiaChannel } from "./notify/concordia-channel.js";
import { CernereClient } from "./cernere/client.js";
import { attachAgentGateway } from "./server/agent-gateway.js";
import { runAgent } from "./agent/agent.js";
import { startSweeper } from "./sweeper.js";
import { logger } from "./shared/logger.js";
import type { ConciliatorConfig } from "./shared/config-types.js";

async function main(): Promise<void> {
  const config = loadConfig();

  // agent モードは server / DB を持たず、監視 + 転送に徹する
  if (config.mode === "agent") {
    await runAgent();
    return;
  }

  openDb();
  await runServer(config);
}

/** standalone / server モードの本体。 */
async function runServer(config: ConciliatorConfig): Promise<void> {
  // 1. エンジン初期化
  riskEngine.syncFromConfig();
  startOrchestrator();
  structureChecker.checkRoots();

  // 2. 通知チャネル (config.concordia があれば Concordia チャットも追加)
  const channels: NotificationChannel[] = [new WsChannel(), new DesktopChannel()];
  if (config.concordia) {
    channels.push(new ConcordiaChannel(config.concordia));
    logger.info("concordia notification channel enabled");
  }
  new Notifier(channels).start();

  // 3. ローカルファイル監視 (config reload で作り直す)
  let watcher = new Watcher();
  watcher.start();
  eventBus.on("config.reloaded", () => {
    void watcher.stop().then(() => {
      watcher = new Watcher();
      watcher.start();
      logger.info("watcher restarted after config reload");
    });
  });

  // 4. HTTP サーバ
  const app = createApp();
  const { port, host } = config.server;
  const server = serve({ fetch: app.fetch, port, hostname: host });
  logger.info({ url: `http://${host}:${port}`, mode: config.mode }, "conciliator server listening");

  // 5. WebSocket — Web UI へライブイベントをブロードキャスト
  const wss = new WebSocketServer({ server: server as never, path: "/ws" });
  wss.on("connection", (ws: WebSocket) => {
    ws.send(JSON.stringify({ type: "hello", ts: Date.now() }));
    const unsubscribe = eventBus.onAny((event) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
    });
    ws.on("close", unsubscribe);
    ws.on("error", unsubscribe);
  });

  // 6. server モード: 遠隔 agent ゲートウェイ (Cernere 認証)
  let agentWss: WebSocketServer | null = null;
  if (config.mode === "server") {
    if (!config.cernere) {
      throw new Error("mode=server には cernere セクションが必要です");
    }
    agentWss = attachAgentGateway(server as never, new CernereClient(config.cernere));
  }

  // 7. sweeper
  const stopSweeper = startSweeper();

  // 8. graceful shutdown
  const shutdown = (signal: string): void => {
    logger.info({ signal }, "shutting down");
    stopSweeper();
    wss.close();
    agentWss?.close();
    void watcher.stop();
    server.close();
    closeDb();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.fatal({ err }, "fatal startup error");
  process.exit(1);
});
