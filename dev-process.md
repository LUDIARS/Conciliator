# Dev process marker

このファイルがあると AI agent が `npm run dev` / `npm run dev:web` を background 起動可能。

- backend: `tsx watch src/server.ts` (port 17340 loopback)
- web: `cd web && npm run dev` (Vite, port 17341 — `/api` `/ws` を 17340 にプロキシ)

Conciliator は loopback 17340 のみで動く。Watcher が `conciliator.config.json` の
watchRoots を監視し、衝突 / 構成 / リスクを検知する。Web UI を使うときは backend を
立ち上げておく。

## Conciliator managed processes

```concordia.processes
{
  "processes": [
    {
      "name": "conciliator-backend",
      "command": "npm run dev",
      "auto_start": false
    },
    {
      "name": "conciliator-web",
      "command": "npm run dev",
      "cwd": "web",
      "auto_start": false
    }
  ]
}
```
