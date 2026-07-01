import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, proxy the PocketBase API and realtime to the local server so the SPA
// is same-origin (cookies + SSE work). In prod the SPA is served by PocketBase.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8090", changeOrigin: true },
      "/_": { target: "http://127.0.0.1:8090", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
  },
});
