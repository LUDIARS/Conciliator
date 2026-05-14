import { Hono } from "hono";
import { fileEventsRepo } from "../db/repos.js";

export const fileEventsRouter = new Hono();

/** GET /api/v1/file-events?root=&since=&limit= */
fileEventsRouter.get("/", (c) => {
  const rootId = c.req.query("root") || undefined;
  const sinceRaw = c.req.query("since");
  const limitRaw = c.req.query("limit");
  const since = sinceRaw ? Number(sinceRaw) : undefined;
  const limit = limitRaw ? Number(limitRaw) : undefined;
  const events = fileEventsRepo.list({
    rootId,
    since: Number.isFinite(since) ? since : undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
  });
  return c.json({ events });
});
