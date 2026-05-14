# Conciliator

git が苦手な領域 — バイナリ (Excel / Maya / Blender)、意図が分解されていない作業 — で、
**作業の衝突を「起きる前に」検知し、意思確認を挟み、起きてしまった衝突はクレバーに
マージ支援する**サービス。

Concordia が *AI セッション* を協調させるなら、Conciliator は *ファイルと作業者* を
協調させる。**lock せず**、検知・通知・マージ支援に徹し、作業者の自律解決を促す。

| 機能 | 概要 |
|------|------|
| 監視 | 宣言した作業領域を再帰監視、バイナリ / 非マージファイルの変更を検知 |
| ロックファイル検知 | `~$*.xlsx` 等から「今そのファイルを開いている作業者」を特定 |
| 作業クレーム | 「誰が・どのパスを・何の目的で」触っているかを宣言 / 推測で登録 |
| 意思確認 | claim 作業者へ「何をしていますか」を問い、意図を記録 |
| 事前通知 | 他者の作業中ファイルを開いた瞬間に通知 — 衝突を顕在化させない |
| クレバーマージ | `.xlsx` / `.ma` 衝突を baseline / A / B の 3-way 差分で提示 + xlsx は書き戻し適用 |
| 構成検証 | 作業領域が規約どおりのフォルダ構成かを照合 |
| リスク監視 | 大量削除 / 秘密混入 / 領域外書込 を検知 |
| マルチホスト | server/agent 分離 + Cernere 認証で遠隔ユーザを識別 (tailnet 経路) |
| AI hook | AI コーディングエージェントの編集も作業者として claim 化 |
| 通知 | Web UI ライブ表示 + OS デスクトップ通知 + (任意) Concordia チャット |

ドキュメント:
- 要件定義: [`spec/requirements.md`](spec/requirements.md)
- v0.1 設計: [`spec/v0.1-design.md`](spec/v0.1-design.md)
- v1.0 追補 (マルチホスト / Cernere / hook / マージ適用 / Maya): [`spec/v1.0-design.md`](spec/v1.0-design.md)

## ラテン語の名前

**Conciliator** — ラテン語で「和解させる者」「引き合わせる者」。動詞 *conciliare*
(結びつける / 和解させる) の行為者名詞。short code: `Cn` (案)。日本語: コンキリアトル。

## ステータス

**v1.0 実装済** — backend / web frontend 実装完了、typecheck + build + test (15 件) green、
standalone / server / agent の 3 モードを smoke test 済み。

## 動作モード

`conciliator.config.json` の `mode` で切り替え:

| mode | 役割 |
|------|------|
| **standalone** | 単一ホスト loopback (既定)。1 インスタンスが共有フォルダを監視 |
| **server** | 中央コーディネータ。遠隔 agent の接続を `/agent` で受ける |
| **agent** | 各ユーザ PC 常駐。ローカル監視 → Cernere 認証付きで server へ転送 |

設定例: `conciliator.server.config.example.json` / `conciliator.agent.config.example.json`

## 起動

```bash
npm install
npm run dev          # backend (17340) — config の mode に従って起動
cd web && npm install && npm run dev   # web UI (17341)
npm test             # vitest (xlsx/maya diff + マージ適用、15 件)
```

`conciliator.config.json` の `watchRoots[].path` を監視したい共有フォルダに書き換えて使う。
server / agent モードは `cernere` セクション + 環境変数 `CONCILIATOR_CERNERE_HMAC`
(server) / `CONCILIATOR_CERNERE_TOKEN` (agent) が必要。

## AI hook (任意)

Claude Code 等の `~/.claude/settings.json` に登録すると、AI の編集も作業者として
claim 化される (opt-in: `CONCILIATOR_HOOK=1`):

```json
"PostToolUse": [{ "matcher": "Edit|Write|MultiEdit", "hooks": [{ "type": "command",
  "command": "node E:/Document/Ars/Conciliator/tools/conciliator-hook.mjs" }] }]
```

## リポ構成

```
Conciliator/
├── conciliator.config.json         # 監視宣言 (source of truth)
├── conciliator.{server,agent}.config.example.json
├── spec/                           # requirements / v0.1-design / v1.0-design
├── src/
│   ├── server.ts                   # mode 分岐 (runServer / runAgent)
│   ├── app.ts events.ts orchestrator.ts sweeper.ts
│   ├── shared/   config-types / logger / types / ids / glob
│   ├── db/       schema / index (migration) / repos
│   ├── config/   loader
│   ├── cernere/  client (project-token + HMAC 検証) / identity (作業者解決)
│   ├── watcher/  watcher (chokidar) + lockfile (Office owner file 解析)
│   ├── claims/   manager + snapshots (agent アップロード対応)
│   ├── collision/ engine    structure/ checker    risk/ engine
│   ├── merge/    xlsx (3-way diff) / apply (書き戻し) / maya (.ma diff)
│   ├── notify/   notifier + concordia-channel
│   ├── agent/    agent (agent モード本体) + protocol
│   ├── server/   agent-gateway (遠隔 agent の WS 受け口)
│   └── api/      Hono ルータ群 (claims / collisions / hook / risk / ...)
├── tools/conciliator-hook.mjs       # AI hook wrapper
├── .claude/skills/conciliator/      # conciliator skill
├── tests/                           # vitest
└── web/                             # React 19 + Vite + Foundation UI
```
