import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// FootageBrain backend the dev proxy forwards to. Defaults to the live
// Hetzner backend (mirrors the production vercel.json /fb rewrite) so the
// app works locally with no extra setup. To test against a local backend,
// run `FB_PROXY_TARGET=http://localhost:8765 npm run dev`.
const FB_TARGET = process.env.FB_PROXY_TARGET || "https://api.footagebrain.com";

export default defineConfig({
  plugins: [react()],
  // Pre-bundle the 3D stack at dev startup. Both the lazy public landing
  // and the lazy owner-only /space route pull in three/fiber/drei; without
  // this, the FIRST visit to either triggers an on-the-fly dep optimization
  // + reload that aborts the in-flight dynamic import ("Failed to fetch
  // dynamically imported module"). Listing them here makes that deterministic.
  optimizeDeps: {
    include: ["three", "@react-three/fiber", "@react-three/drei"],
  },
  server: {
    port: 8000,
    open: "/index.html",
    proxy: {
      // Footage Brain backend — proxied so the browser sees same-origin
      // requests and CORS doesn't apply. Client uses /fb/api/... and
      // /fb/health; Vite rewrites the /fb prefix away before forwarding.
      // secure:false so local TLS interception (Avast) doesn't break the hop.
      "/fb": {
        target: FB_TARGET,
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/fb/, ""),
      },
      // Thumbnails served by Footage Brain — same trick so <img src="/thumbnails/...">
      // doesn't hit the Vite dev server (which would 404 it).
      "/thumbnails": {
        target: FB_TARGET,
        changeOrigin: true,
        secure: false,
      },
      // Vercel serverless functions — proxied so /api/* works with `vercel dev`
      // running on port 3001 alongside `npm run dev` on port 8000.
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
