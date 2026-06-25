import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./theme-accessible.css";
import "./styles-solarin.css";
import { App } from "./app.jsx";
import { initPerfTracker } from "./lib/perf-tracker.js";

createRoot(document.getElementById("root")).render(<App />);

/* D3 — Web-Vitals perf collector. Init ONCE here (module scope, after
   the app mounts). It self-resolves person_id from the active Supabase
   session/`people` row (same lookup AuthProvider does), buffers vitals,
   and writes exactly one perf_samples row per session on page-hide.
   Idempotent + fully self-degrading, so it can't affect boot. */
initPerfTracker();
