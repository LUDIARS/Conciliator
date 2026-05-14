import { Hono } from "hono";
import { z } from "zod";
import { auditRepo, watchRootsRepo } from "../db/repos.js";
import { claimManager } from "../claims/manager.js";
import { identityForAi } from "../cernere/identity.js";
import { resolve } from "node:path";
import { logger } from "../shared/logger.js";

export const hookRouter = new Hono();

const editSchema = z.object({
  /** AI セッションのラベル (Claude Code の role 等)。 */
  agentLabel: z.string().min(1),
  /** 編集されたファイルの絶対パス。 */
  path: z.string().min(1),
  /** 任意の作業意図 (hook が要約を渡せる)。 */
  intentText: z.string().optional(),
});

/**
 * POST /api/v1/hook/edit — AI コーディングエージェントの PostToolUse(Edit|Write) フック。
 * 編集されたファイルが監視ルート配下のバイナリ glob に当たれば、AI 作業者として
 * inferred claim を起こす (= 人間の作業と AI の作業の衝突も検知できる)。
 */
hookRouter.post("/edit", async (c) => {
  const parsed = editSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid body", detail: parsed.error.flatten() }, 400);
  }
  const { agentLabel, path, intentText } = parsed.data;
  const absPath = resolve(path);

  // どの watch root 配下か判定
  const root = watchRootsRepo
    .list()
    .find((r) => absPath.toLowerCase().startsWith(r.path.toLowerCase()));
  if (!root) {
    return c.json({ ignored: true, reason: "監視ルート外のファイル" });
  }

  const claim = claimManager.infer({
    rootId: root.id,
    targetPath: absPath,
    identity: identityForAi(agentLabel),
  });
  if (intentText) claimManager.setIntent(claim.id, intentText);

  auditRepo.record({
    actor: agentLabel,
    action: "hook.edit",
    targetType: "claim",
    targetId: claim.id,
    payload: { path: absPath },
  });
  logger.info({ claim: claim.id, agentLabel, path: absPath }, "AI hook claim");
  return c.json({ claim: { id: claim.id, path: claim.path, status: claim.status } });
});
