import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  server: {
    // Certificates are local-only and must not be required by production builds.
    https: command === "serve" ? {
      key: readFileSync(resolve(".cert/localhost-key.pem")),
      cert: readFileSync(resolve(".cert/localhost.pem")),
    } : undefined,
    proxy: {
      "/api/agent": { target: "http://127.0.0.1:3000", changeOrigin: true },
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: true },
    },
  },
}));
