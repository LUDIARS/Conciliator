#!/usr/bin/env node
// Conciliator AI hook wrapper.
// Claude Code 等の PostToolUse(Edit|Write) フックから呼ばれ、編集ファイルを
// Conciliator に通知して AI 作業者の inferred claim を起こす。
//
// 設定 (~/.claude/settings.json):
//   "PostToolUse": [{ "matcher": "Edit|Write|MultiEdit", "hooks": [{ "type": "command",
//     "command": "node E:/Document/Ars/Conciliator/tools/conciliator-hook.mjs" }] }]
//
// opt-in: 環境変数 CONCILIATOR_HOOK=1 のセッションでのみ動く (sub-agent 等の誤登録防止)。
// 失敗してもエージェントをブロックしないよう、常に exit 0。

import { stdin } from "node:process";

const URL = process.env.CONCILIATOR_URL ?? "http://127.0.0.1:17340";

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    stdin.setEncoding("utf8");
    stdin.on("data", (c) => (data += c));
    stdin.on("end", () => resolve(data));
    stdin.on("error", () => resolve(""));
    setTimeout(() => resolve(data), 1500);
  });
}

async function main() {
  if (process.env.CONCILIATOR_HOOK !== "1") return;

  const raw = await readStdin();
  if (!raw) return;
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }

  const toolName = input.tool_name ?? "";
  if (!/^(Edit|Write|MultiEdit)$/.test(toolName)) return;

  const filePath = input.tool_input?.file_path ?? input.tool_input?.path;
  if (!filePath) return;

  const sessionId = String(input.session_id ?? "session");
  const agentLabel = `claude-${sessionId.slice(0, 8)}`;

  try {
    await fetch(`${URL}/api/v1/hook/edit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentLabel, path: filePath }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // Conciliator 未起動でもエージェントは止めない
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
