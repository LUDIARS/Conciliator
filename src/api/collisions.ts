import { Hono } from "hono";
import { z } from "zod";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { auditRepo, claimsRepo, collisionsRepo, snapshotsRepo, workersRepo } from "../db/repos.js";
import { eventBus } from "../events.js";
import { readSnapshotContent } from "../claims/snapshots.js";
import { diffXlsx } from "../merge/xlsx.js";
import { diffMaya } from "../merge/maya.js";
import { applyXlsxMerge } from "../merge/apply.js";
import { nowSec } from "../shared/ids.js";
import type { CollisionRow, CollisionStatus } from "../shared/types.js";

export const collisionsRouter = new Hono();

const XLSX_EXTS = new Set([".xlsx", ".xlsm"]);
const MAYA_EXTS = new Set([".ma"]);

function diffFormat(path: string): "xlsx" | "maya" | null {
  const ext = extname(path).toLowerCase();
  if (XLSX_EXTS.has(ext)) return "xlsx";
  if (MAYA_EXTS.has(ext)) return "maya";
  return null;
}

function expand(collision: CollisionRow) {
  const claimA = claimsRepo.get(collision.claim_a);
  const claimB = claimsRepo.get(collision.claim_b);
  const wa = claimA ? workersRepo.get(claimA.worker_id) : undefined;
  const wb = claimB ? workersRepo.get(claimB.worker_id) : undefined;
  return {
    ...collision,
    claimADetail: claimA
      ? { id: claimA.id, worker: wa?.label ?? null, intent: claimA.intent_text }
      : null,
    claimBDetail: claimB
      ? { id: claimB.id, worker: wb?.label ?? null, intent: claimB.intent_text }
      : null,
  };
}

/** GET /api/v1/collisions?status= */
collisionsRouter.get("/", (c) => {
  const status = c.req.query("status") as CollisionStatus | undefined;
  return c.json({ collisions: collisionsRepo.list(status).map(expand) });
});

const patchSchema = z.object({
  status: z.enum(["ack", "resolved", "dismissed"]),
});

/** PATCH /api/v1/collisions/:id — triage */
collisionsRouter.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid body" }, 400);
  if (!collisionsRepo.get(id)) return c.json({ error: "collision not found" }, 404);

  const collision = collisionsRepo.setStatus(id, parsed.data.status);
  if (collision) eventBus.emit({ type: "collision.updated", collision });
  auditRepo.record({
    actor: "api",
    action: `collision.${parsed.data.status}`,
    targetType: "collision",
    targetId: id,
  });
  return c.json({ collision: collision ? expand(collision) : null });
});

/**
 * GET /api/v1/collisions/:id/diff — xlsx クレバーマージの構造化 diff。
 *
 * 3-way の各バージョンは時系列で:
 *   baseline = claim_a (先行) の baseline スナップショット
 *   a        = claim_b (後発) の baseline スナップショット (= claim_a の作業後の状態)
 *   b        = ディスク上の現在のファイル (= 最新の保存内容)
 */
collisionsRouter.get("/:id/diff", (c) => {
  const id = c.req.param("id");
  const collision = collisionsRepo.get(id);
  if (!collision) return c.json({ error: "collision not found" }, 404);

  const format = diffFormat(collision.path);
  if (!format) {
    return c.json(
      {
        error: "unsupported",
        detail: `クレバーマージ対応は .xlsx / .xlsm / .ma のみ (${extname(collision.path)})`,
      },
      422,
    );
  }

  const claimA = claimsRepo.get(collision.claim_a);
  const claimB = claimsRepo.get(collision.claim_b);
  const snapA = claimA?.snapshot_id ? snapshotsRepo.get(claimA.snapshot_id) : undefined;
  const snapB = claimB?.snapshot_id ? snapshotsRepo.get(claimB.snapshot_id) : undefined;

  if (!snapA || !snapB) {
    return c.json(
      {
        error: "no-snapshot",
        detail: "両 claim の baseline スナップショットが揃っていません (サイズ上限超過 等)",
      },
      422,
    );
  }
  if (!existsSync(collision.path)) {
    return c.json({ error: "file-missing", detail: "対象ファイルが現在ディスク上にありません" }, 422);
  }

  try {
    const baseline = readSnapshotContent(snapA);
    const a = readSnapshotContent(snapB);
    const b = readFileSync(collision.path);
    const diff = format === "xlsx" ? diffXlsx(baseline, a, b) : diffMaya(baseline, a, b);
    return c.json({
      collision: expand(collision),
      format,
      legend: {
        baseline: `${claimA?.id} の baseline (最古)`,
        a: `${claimB?.id} の baseline (中間 = ${claimA?.id} の作業後)`,
        b: "ディスク上の現在ファイル (最新)",
      },
      diff,
    });
  } catch (err) {
    return c.json({ error: "diff-failed", detail: String(err) }, 500);
  }
});

const mergeSchema = z.object({
  resolutions: z
    .array(
      z.object({
        sheet: z.string(),
        ref: z.string(),
        value: z.string(),
      }),
    )
    .min(1),
});

/**
 * POST /api/v1/collisions/:id/merge — 選択したセル解決を書き戻したマージ済み xlsx を生成。
 * 原本は上書きせず、サイドカー (`*.conciliator-merged.xlsx`) として保存する。
 */
collisionsRouter.post("/:id/merge", async (c) => {
  const id = c.req.param("id");
  const collision = collisionsRepo.get(id);
  if (!collision) return c.json({ error: "collision not found" }, 404);
  if (diffFormat(collision.path) !== "xlsx") {
    return c.json({ error: "unsupported", detail: "マージ適用は .xlsx / .xlsm のみ対応" }, 422);
  }
  if (!existsSync(collision.path)) {
    return c.json({ error: "file-missing", detail: "対象ファイルが現在ディスク上にありません" }, 422);
  }
  const parsed = mergeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid body", detail: parsed.error.flatten() }, 400);
  }

  try {
    const merged = applyXlsxMerge(readFileSync(collision.path), parsed.data.resolutions);
    const ext = extname(collision.path);
    const outPath = join(
      dirname(collision.path),
      `${collision.path.slice(0, -ext.length).split(/[\\/]/).pop()}.conciliator-merged${ext}`,
    );
    writeFileSync(outPath, merged);
    auditRepo.record({
      actor: "api",
      action: "collision.merge-apply",
      targetType: "collision",
      targetId: id,
      payload: { outPath, cells: parsed.data.resolutions.length },
    });
    return c.json({ ok: true, outPath, mergedCells: parsed.data.resolutions.length, ts: nowSec() });
  } catch (err) {
    return c.json({ error: "merge-failed", detail: String(err) }, 500);
  }
});
