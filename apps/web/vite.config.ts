import path from "node:path";
import process from "node:process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** In Docker Compose set VITE_PROXY_TARGET to the API service (e.g. http://api:4000). Local dev defaults to loopback. */
const proxyTarget = process.env.VITE_PROXY_TARGET || "http://127.0.0.1:4000";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: 5174,
    proxy: {
      "/api": { target: proxyTarget, changeOrigin: true },
      "/ws": { target: proxyTarget.replace(/^http/, "ws"), ws: true },
    },
  },
});
