import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// backend は loopback 17340。dev server は 17341 で立て、API / WS をプロキシする。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 17341,
    host: "127.0.0.1",
    proxy: {
      "/api": { target: "http://127.0.0.1:17340", changeOrigin: true },
      "/health": { target: "http://127.0.0.1:17340", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:17340", ws: true },
    },
  },
  build: { outDir: "dist" },
});
