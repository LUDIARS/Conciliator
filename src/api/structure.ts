import { Hono } from "hono";
import { z } from "zod";
import { auditRepo, structureRepo } from "../db/repos.js";
import type { TriageStatus } from "../shared/types.js";

export const structureRouter = new Hono();

/** GET /api/v1/structure/violations?status= */
structureRouter.get("/violations", (c) => {
  const status = c.req.query("status") as TriageStatus | undefined;
  return c.json({ violations: structureRepo.list(status) });
});

const patchSchema = z.object({
  status: z.enum(["ack", "resolved", "dismissed"]),
});

/** PATCH /api/v1/structure/violations/:id — triage */
structureRouter.patch("/violations/:id", async (c) => {
  const id = c.req.param("id");
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid body" }, 400);
  if (!structureRepo.get(id)) return c.json({ error: "violation not found" }, 404);

  const violation = structureRepo.setStatus(id, parsed.data.status);
  auditRepo.record({
    actor: "api",
    action: `structure.${parsed.data.status}`,
    targetType: "structure_violation",
    targetId: id,
  });
  return c.json({ violation });
});
