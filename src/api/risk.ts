import { Hono } from "hono";
import { z } from "zod";
import { auditRepo, riskAlertsRepo, riskRulesRepo } from "../db/repos.js";
import { riskRuleSchema } from "../shared/config-types.js";
import type { TriageStatus } from "../shared/types.js";

export const riskRouter = new Hono();

/** GET /api/v1/risk/alerts?status= */
riskRouter.get("/alerts", (c) => {
  const status = c.req.query("status") as TriageStatus | undefined;
  return c.json({ alerts: riskAlertsRepo.list(status) });
});

const alertPatchSchema = z.object({
  status: z.enum(["ack", "resolved", "dismissed"]),
});

/** PATCH /api/v1/risk/alerts/:id — triage */
riskRouter.patch("/alerts/:id", async (c) => {
  const id = c.req.param("id");
  const parsed = alertPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid body" }, 400);
  if (!riskAlertsRepo.get(id)) return c.json({ error: "alert not found" }, 404);

  const alert = riskAlertsRepo.setStatus(id, parsed.data.status);
  auditRepo.record({
    actor: "api",
    action: `risk.${parsed.data.status}`,
    targetType: "risk_alert",
    targetId: id,
  });
  return c.json({ alert });
});

/** GET /api/v1/risk/rules */
riskRouter.get("/rules", (c) => {
  const rules = riskRulesRepo.listAll().map((r) => ({
    id: r.id,
    enabled: r.enabled === 1,
    source: r.source,
    addedAt: r.added_at,
    rule: JSON.parse(r.rule_json) as unknown,
  }));
  return c.json({ rules });
});

/** POST /api/v1/risk/rules — ランタイムルール追加 */
riskRouter.post("/rules", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = riskRuleSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid rule", detail: parsed.error.flatten() }, 400);
  }
  const rule = riskRulesRepo.addRuntimeRule(parsed.data.id, JSON.stringify(parsed.data));
  auditRepo.record({
    actor: "api",
    action: "risk.rule.add",
    targetType: "risk_rule",
    targetId: rule.id,
    payload: parsed.data,
  });
  return c.json({ rule: { id: rule.id, enabled: true, source: rule.source } }, 201);
});

const enableSchema = z.object({ enabled: z.boolean() });

/** PATCH /api/v1/risk/rules/:id — 有効/無効切り替え */
riskRouter.patch("/rules/:id", async (c) => {
  const id = c.req.param("id");
  const parsed = enableSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid body" }, 400);
  riskRulesRepo.setEnabled(id, parsed.data.enabled);
  auditRepo.record({
    actor: "api",
    action: "risk.rule.toggle",
    targetType: "risk_rule",
    targetId: id,
    payload: { enabled: parsed.data.enabled },
  });
  return c.json({ ok: true });
});
