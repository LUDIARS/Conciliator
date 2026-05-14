import { readFileSync, watch as fsWatch } from "node:fs";
import { resolve } from "node:path";
import { configSchema, type ConciliatorConfig, type WatchRootConfig } from "../shared/config-types.js";
import { eventBus } from "../events.js";
import { logger } from "../shared/logger.js";
import { nowSec } from "../shared/ids.js";

const CONFIG_PATH = resolve(process.env.CONCILIATOR_CONFIG ?? "conciliator.config.json");

let current: ConciliatorConfig | null = null;

/** watch root の path を絶対パスに解決した版。 */
export interface ResolvedWatchRoot extends WatchRootConfig {
  absPath: string;
}

function parseConfig(raw: string): ConciliatorConfig {
  const json = JSON.parse(raw) as unknown;
  return configSchema.parse(json);
}

/** 起動時に 1 度呼ぶ。設定を読み、ファイル watch を仕掛ける。 */
export function loadConfig(): ConciliatorConfig {
  current = parseConfig(readFileSync(CONFIG_PATH, "utf8"));
  logger.info({ path: CONFIG_PATH, roots: current.watchRoots.length }, "config loaded");

  let debounce: NodeJS.Timeout | null = null;
  try {
    fsWatch(CONFIG_PATH, () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        try {
          current = parseConfig(readFileSync(CONFIG_PATH, "utf8"));
          logger.info("config reloaded");
          eventBus.emit({ type: "config.reloaded", ts: nowSec() });
        } catch (err) {
          logger.error({ err }, "config reload failed — keeping previous config");
        }
      }, 300);
    });
  } catch (err) {
    logger.warn({ err }, "config file watch unavailable — hot reload disabled");
  }

  return current;
}

export function getConfig(): ConciliatorConfig {
  if (!current) throw new Error("config not loaded — call loadConfig() first");
  return current;
}

export function getResolvedRoots(): ResolvedWatchRoot[] {
  return getConfig().watchRoots.map((r) => ({ ...r, absPath: resolve(r.path) }));
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}
