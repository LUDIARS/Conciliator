import { Hono } from "hono";
import {
  auditRepo,
  claimsRepo,
  collisionsRepo,
  riskAlertsRepo,
  structureRepo,
  watchRootsRepo,
  workersRepo,
} from "../db/repos.js";

export const metaRouter = new Hono();

/** GET /api/v1/overview — Monitor 画面用の集計 */
metaRouter.get("/overview", (c) => {
  const collisions = collisionsRepo.list();
  const riskAlerts = riskAlertsRepo.list();
  return c.json({
    watchRoots: watchRootsRepo.list().length,
    workers: workersRepo.list().length,
    claims: {
      active: claimsRepo.list("active").length,
      stale: claimsRepo.list("stale").length,
      released: claimsRepo.list("released").length,
    },
    collisions: {
      open: collisions.filter((x) => x.status === "open").length,
      manifest: collisions.filter((x) => x.status === "open" && x.phase === "manifest").length,
      pre: collisions.filter((x) => x.status === "open" && x.phase === "pre").length,
      resolved: collisions.filter((x) => x.status === "resolved").length,
    },
    structureViolations: {
      open: structureRepo.list("open").length,
    },
    riskAlerts: {
      open: riskAlerts.filter((x) => x.status === "open").length,
      high: riskAlerts.filter((x) => x.status === "open" && x.severity === "high").length,
    },
  });
});

/** GET /api/v1/workers */
metaRouter.get("/workers", (c) => {
  return c.json({ workers: workersRepo.list() });
});

/** GET /api/v1/audit?limit= */
metaRouter.get("/audit", (c) => {
  const limitRaw = c.req.query("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  return c.json({ audit: auditRepo.list(Number.isFinite(limit) ? limit : undefined) });
});
