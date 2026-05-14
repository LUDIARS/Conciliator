import { z } from "zod";

/** conciliator.config.json のスキーマ。Zod が source of truth。 */

export const namingRuleSchema = z.object({
  glob: z.string(),
  /** ファイル名 (basename) がこの正規表現にマッチしなければ違反。 */
  pattern: z.string(),
});

export const structureSchema = z.object({
  /** watch root 直下に必須のディレクトリ。 */
  requireDirs: z.array(z.string()).default([]),
  /** glob にマッチするファイルの命名規約。 */
  namingRules: z.array(namingRuleSchema).default([]),
  /** 存在してはいけない glob。 */
  forbidGlobs: z.array(z.string()).default([]),
});

export const watchRootSchema = z.object({
  id: z.string(),
  label: z.string(),
  path: z.string(),
  /** 衝突監視の対象とするバイナリ / 非マージファイルの glob。 */
  binaryGlobs: z.array(z.string()).default(["**/*.xlsx", "**/*.xlsm"]),
  /** 監視から除外する glob。 */
  ignore: z.array(z.string()).default(["**/node_modules/**", "**/.git/**", "**/~$*"]),
  structure: structureSchema.default({ requireDirs: [], namingRules: [], forbidGlobs: [] }),
});

const severitySchema = z.enum(["low", "medium", "high"]).default("medium");

export const riskRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string(),
    kind: z.literal("count"),
    event: z.enum(["add", "change", "delete", "rename"]),
    windowSec: z.number().int().positive(),
    threshold: z.number().int().positive(),
    severity: severitySchema,
  }),
  z.object({
    id: z.string(),
    kind: z.literal("content"),
    /** 新規 / 変更ファイルの内容にマッチさせる正規表現。 */
    match: z.string(),
    on: z.enum(["add", "change"]).default("add"),
    severity: severitySchema,
  }),
  z.object({
    id: z.string(),
    kind: z.literal("path"),
    match: z.enum(["outsideWatchRoot"]),
    severity: severitySchema,
  }),
]);

/** Cernere 認証連携 (server / agent モードで使用)。 */
export const cernereSchema = z.object({
  /** Cernere のベース URL (例 http://localhost:8080)。 */
  baseUrl: z.string(),
  /** Conciliator が Cernere に登録された project id。 */
  projectId: z.string(),
  /**
   * project-token を検証するための HMAC secret。
   * 未指定なら環境変数 CONCILIATOR_CERNERE_HMAC を使う (per-user / memory-only)。
   */
  hmacSecretEnv: z.string().default("CONCILIATOR_CERNERE_HMAC"),
});

/** Concordia チャット通知連携 (任意、v0.2 の通知チャネル)。 */
export const concordiaSchema = z.object({
  baseUrl: z.string().default("http://127.0.0.1:17330"),
  channel: z.string().default("system"),
  authorLabel: z.string().default("Conciliator"),
});

/** agent モード設定。 */
export const agentSchema = z.object({
  /** server (mode=server の Conciliator) の WS URL。tailnet 越しを想定。 */
  serverUrl: z.string(),
  /** この agent を識別する安定 id (省略時は host 名から導出)。 */
  agentId: z.string().optional(),
  /**
   * Cernere accessToken を読む環境変数名。
   * 対話ログインは別途 (`conciliator login` 等) で行いトークンを env に置く運用。
   */
  accessTokenEnv: z.string().default("CONCILIATOR_CERNERE_TOKEN"),
});

export const configSchema = z
  .object({
    /** 動作モード: standalone (単一ホスト) / server (中央) / agent (各 PC)。 */
    mode: z.enum(["standalone", "server", "agent"]).default("standalone"),
    watchRoots: z.array(watchRootSchema).default([]),
    riskRules: z.array(riskRuleSchema).default([]),
    claim: z
      .object({
        staleAfterSec: z.number().int().positive().default(1800),
        snapshotMaxBytes: z.number().int().positive().default(52_428_800),
      })
      .default({ staleAfterSec: 1800, snapshotMaxBytes: 52_428_800 }),
    server: z
      .object({
        port: z.number().int().positive().default(17340),
        host: z.string().default("127.0.0.1"),
      })
      .default({ port: 17340, host: "127.0.0.1" }),
    cernere: cernereSchema.optional(),
    concordia: concordiaSchema.optional(),
    agent: agentSchema.optional(),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.mode !== "server" && cfg.watchRoots.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `mode=${cfg.mode} では watchRoots が 1 つ以上必要です`,
        path: ["watchRoots"],
      });
    }
    if (cfg.mode === "agent" && !cfg.agent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "mode=agent では agent セクションが必要です",
        path: ["agent"],
      });
    }
    if (cfg.mode !== "standalone" && !cfg.cernere) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `mode=${cfg.mode} では cernere セクションが必要です (識別と認証に使用)`,
        path: ["cernere"],
      });
    }
  });

export type ConciliatorConfig = z.infer<typeof configSchema>;
export type WatchRootConfig = z.infer<typeof watchRootSchema>;
export type StructureConfig = z.infer<typeof structureSchema>;
export type RiskRuleConfig = z.infer<typeof riskRuleSchema>;
export type CernereConfig = z.infer<typeof cernereSchema>;
export type ConcordiaConfig = z.infer<typeof concordiaSchema>;
export type AgentConfig = z.infer<typeof agentSchema>;
