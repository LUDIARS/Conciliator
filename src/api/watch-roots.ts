import { Hono } from "hono";
import { fileEventsRepo, watchRootsRepo } from "../db/repos.js";
import { nowSec } from "../shared/ids.js";

export const watchRootsRouter = new Hono();

/** GET /api/v1/watch-roots — 監視ルート一覧 + 直近 24h のイベント数 */
watchRootsRouter.get("/", (c) => {
  const since = nowSec() - 24 * 3600;
  const roots = watchRootsRepo.list().map((r) => ({
    id: r.id,
    label: r.label,
    path: r.path,
    config: JSON.parse(r.config_json) as unknown,
    loadedAt: r.loaded_at,
    recentEventCount: fileEventsRepo.list({ rootId: r.id, since, limit: 1000 }).length,
  }));
  return c.json({ roots });
});
