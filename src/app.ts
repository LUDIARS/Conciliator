import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { watchRootsRouter } from "./api/watch-roots.js";
import { fileEventsRouter } from "./api/file-events.js";
import { claimsRouter } from "./api/claims.js";
import { collisionsRouter } from "./api/collisions.js";
import { structureRouter } from "./api/structure.js";
import { riskRouter } from "./api/risk.js";
import { hookRouter } from "./api/hook.js";
import { metaRouter } from "./api/meta.js";
import { SCHEMA_VERSION } from "./db/schema.js";

/** Hono アプリを組み立てる。 */
export function createApp(): Hono {
  const app = new Hono();

  // ローカル開発時、Web (Vite) が別ポートから叩くため CORS を許可 (loopback only)
  app.use("/api/*", cors({ origin: (o) => o, credentials: true }));

  app.get("/health", (c) =>
    c.json({ ok: true, service: "conciliator", schemaVersion: SCHEMA_VERSION }),
  );

  app.route("/api/v1/watch-roots", watchRootsRouter);
  app.route("/api/v1/file-events", fileEventsRouter);
  app.route("/api/v1/claims", claimsRouter);
  app.route("/api/v1/collisions", collisionsRouter);
  app.route("/api/v1/structure", structureRouter);
  app.route("/api/v1/risk", riskRouter);
  app.route("/api/v1/hook", hookRouter);
  app.route("/api/v1", metaRouter);

  // production: web/dist を静的配信
  if (existsSync("web/dist")) {
    app.use("/*", serveStatic({ root: "./web/dist" }));
    app.get("/*", serveStatic({ path: "./web/dist/index.html" }));
  }

  return app;
}
