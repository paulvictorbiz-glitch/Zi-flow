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
    include: ["three", "@react-three/fiber", "@react-three/drei", "@react-three/postprocessing", "postprocessing"],
  },
  // B2 VENDOR SPLIT — pull the two obvious heavy vendor groups into their own
  // chunks so they only download when a page that uses them is opened (the 3D
  // stack is only on the lazy landing + owner-only /space route; the Maps SDK
  // only on Locations/Coverage). Path-prefix matching on node_modules is
  // resolution-agnostic, so this is chunking-only and can't break the build.
  // Anything not matched falls through to Rollup's default chunking. No
  // charting lib is in the dependency set, so none is split.
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (
            id.includes("/three/") ||
            id.includes("/@react-three/") ||
            id.includes("/postprocessing/")
          ) {
            return "vendor-three";
          }
          if (
            id.includes("/@vis.gl/react-google-maps/") ||
            id.includes("/@googlemaps/")
          ) {
            return "vendor-maps";
          }
          return undefined;
        },
      },
    },
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
