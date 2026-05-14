import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 8000,
    open: "/index.html",
    proxy: {
      // Footage Brain backend — proxied so the browser sees same-origin
      // requests and CORS doesn't apply. Client uses /fb/api/... and
      // /fb/health; Vite rewrites the /fb prefix away before forwarding
      // to localhost:8765.
      "/fb": {
        target: "http://localhost:8765",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/fb/, ""),
      },
      // Thumbnails served by Footage Brain — same trick so <img src="/thumbnails/...">
      // doesn't hit the Vite dev server (which would 404 it).
      "/thumbnails": {
        target: "http://localhost:8765",
        changeOrigin: true,
      },
    },
  },
});
