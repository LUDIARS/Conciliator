---
name: conciliator
description: >-
  Conciliator (作業衝突の検知・予防・マージ支援サービス) との連携スキル。
  AI コーディングエージェントが監視ルート配下のバイナリ / 非マージファイル
  (Excel / Maya 等) を編集する際、Conciliator が出す衝突通知を解釈し、
  人間や他セッションとの作業衝突がある場合はユーザに確認してから進める。
---

# Conciliator 連携スキル

Conciliator は git が苦手なファイル (Excel / Maya / Blender 等) の **作業衝突**を
検知・予防・マージ支援するローカルサービス (既定 `http://127.0.0.1:17340`)。

## hook の仕組み

`tools/conciliator-hook.mjs` が PostToolUse(Edit|Write) で発火し、編集ファイルを
`POST /api/v1/hook/edit` に通知する。これにより **AI の作業も 1 つの作業者**として
claim 化され、人間や他 AI セッションの作業との衝突が検知される。

opt-in: 環境変数 `CONCILIATOR_HOOK=1` のセッションでのみ hook が動く。

## このスキルが行うこと

監視ルート配下のバイナリ / 非マージファイルを編集しようとするとき:

1. **編集前の確認** — そのファイルに対する他作業者の active claim があるか
   `GET /api/v1/claims?status=active` で確認する。あれば、その作業者と意図を
   ユーザに伝え、**進めてよいか確認してから**編集する (lock はしない、助言)。

2. **衝突通知の解釈** — Conciliator から pre-collision / manifest-collision の
   通知が来たら:
   - **pre (事前)**: まだ顕在化していない。ユーザに「○○ さんが同じファイルを
     作業中です。先に調整しますか?」と確認する。勝手に上書きしない。
   - **manifest (顕在化)**: 既に両者が保存済み。`GET /api/v1/collisions/:id/diff`
     でセル単位の 3-way diff を取得し、競合セルをユーザに提示する。

3. **意図の記録** — 自分が claim を持っている場合、作業内容が定まったら
   `POST /api/v1/claims/:id/intent` で意図テキストを記録しておく
   (他作業者が衝突回避の判断に使える)。

## 主な API

| 用途 | エンドポイント |
|------|----------------|
| active claim 一覧 | `GET /api/v1/claims?status=active` |
| 衝突一覧 | `GET /api/v1/collisions?status=open` |
| 衝突の構造化 diff | `GET /api/v1/collisions/:id/diff` |
| マージ適用 (xlsx) | `POST /api/v1/collisions/:id/merge` |
| 意図の記録 | `POST /api/v1/claims/:id/intent` |

## 原則

- **lock しない / 上書きしない** — Conciliator は助言。最終判断はユーザ。
- 衝突が疑われるバイナリファイルは、**ユーザ確認なしに編集を強行しない**。
- Conciliator が未起動 (接続失敗) でもエージェントの作業は止めない。
