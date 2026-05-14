import { Hono } from "hono";
import { z } from "zod";
import { auditRepo, claimsRepo, workersRepo } from "../db/repos.js";
import { claimManager } from "../claims/manager.js";
import { identityForAi, identityFromLocal } from "../cernere/identity.js";
import type { ClaimRow, ClaimStatus } from "../shared/types.js";

export const claimsRouter = new Hono();

function withWorker(claim: ClaimRow) {
  const worker = workersRepo.get(claim.worker_id);
  return {
    ...claim,
    worker: worker
      ? {
          id: worker.id,
          label: worker.label,
          host: worker.host,
          kind: worker.kind,
          cernereUserId: worker.cernere_user_id,
        }
      : null,
  };
}

/** GET /api/v1/claims?status= */
claimsRouter.get("/", (c) => {
  const status = c.req.query("status") as ClaimStatus | undefined;
  const claims = claimsRepo.list(status).map(withWorker);
  return c.json({ claims });
});

const declareSchema = z.object({
  rootId: z.string().min(1),
  path: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["human", "ai"]).optional(),
  cernereUserId: z.string().optional(),
  intentText: z.string().optional(),
});

/** POST /api/v1/claims — 明示宣言で claim を作成 */
claimsRouter.post("/", async (c) => {
  const parsed = declareSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid body", detail: parsed.error.flatten() }, 400);
  }
  const { rootId, path, label, kind, cernereUserId, intentText } = parsed.data;
  const identity =
    kind === "ai"
      ? identityForAi(label)
      : identityFromLocal(label, cernereUserId ?? null);
  const claim = claimManager.declare({ rootId, path, identity, intentText });
  auditRepo.record({
    actor: parsed.data.label,
    action: "claim.declare",
    targetType: "claim",
    targetId: claim.id,
    payload: { path: claim.path },
  });
  return c.json({ claim: withWorker(claim) }, 201);
});

const patchSchema = z.object({
  action: z.enum(["release"]),
});

/** PATCH /api/v1/claims/:id — release */
claimsRouter.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid body" }, 400);
  if (!claimsRepo.get(id)) return c.json({ error: "claim not found" }, 404);

  const claim = claimManager.release(id);
  auditRepo.record({
    actor: "api",
    action: "claim.release",
    targetType: "claim",
    targetId: id,
  });
  return c.json({ claim: claim ? withWorker(claim) : null });
});

const intentSchema = z.object({
  intentText: z.string().min(1),
});

/** POST /api/v1/claims/:id/intent — 意思確認の回答を記録 */
claimsRouter.post("/:id/intent", async (c) => {
  const id = c.req.param("id");
  const parsed = intentSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid body" }, 400);
  if (!claimsRepo.get(id)) return c.json({ error: "claim not found" }, 404);

  const claim = claimManager.setIntent(id, parsed.data.intentText);
  auditRepo.record({
    actor: "api",
    action: "claim.intent",
    targetType: "claim",
    targetId: id,
    payload: { intentText: parsed.data.intentText },
  });
  return c.json({ claim: claim ? withWorker(claim) : null });
});
