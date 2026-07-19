#!/usr/bin/env node
/**
 * Repeatable client-onboarding runbook printer.
 *
 *   node --env-file=.env.local scripts/onboard-client.mjs \
 *     --slug leroy-crosby --name "Leroy Crosby" --path "C:/Users/Leroy/Videos/leroy finance shorts"
 *
 *   node --env-file=.env.local scripts/onboard-client.mjs --slug ... --name ... --path ... --json
 *   node --env-file=.env.local scripts/onboard-client.mjs --slug ... --name ... --path ... --preflight
 *   node --env-file=.env.local scripts/onboard-client.mjs --help
 *
 * WHAT THIS PRINTS (never performs, by default): the exact human-gated
 * sequence to bring one new client/workspace online, end to end —
 *   STEP 1  the public.workspaces INSERT SQL                     (C4)
 *   STEP 2  the backend POST /api/sources body                   (C7)
 *   STEP 3  the ingest/scan trigger call                         (C7)
 *   STEP 4  a read-only scan-status poll                         (C7, read-only)
 *   STEP 5  a scoped POST /api/search verification call          (C3/C8)
 *
 * DRY-RUN ALWAYS (cross-team contract C8 + CLAUDE.md HARD SAFETY RULES
 * 2/3/7): this file contains ZERO `.insert`/`.update`/`.upsert`/`.rpc` calls
 * and ZERO live POSTs to the backend, anywhere. It only builds strings and
 * prints them. `--execute` is accepted as a flag ONLY so it can hard-refuse
 * it (exit 1) with a clear pointer to the human-gated apply flow — dev and
 * prod share the same Supabase DB (CLAUDE.md rule 2) and the backend's own
 * live Postgres is a separate human-gated system (rule 4), so there is no
 * "safe, non-prod" target this script could ever execute against.
 *
 * `--preflight` is the ONLY flag that performs any network/DB call, and it
 * is strictly read-only: a SELECT against Supabase `workspaces` (service-role
 * key from .env.local, same env vars as scripts/migrate.mjs) to flag a slug
 * collision, plus a read-only GET against the backend's /api/sources to flag
 * a path collision. Neither writes anything.
 */

import { existsSync } from "node:fs";

// Canonical slug validator — copied verbatim from src/lib/workspace.jsx
// (C2: every team copies this exact pattern; nobody redefines/normalizes it).
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

const DEFAULT_API_BASE = "https://api.footagebrain.com";

const HELP = `
onboard-client.mjs — DRY-RUN client-onboarding runbook printer

Usage:
  node --env-file=.env.local scripts/onboard-client.mjs --slug <slug> --name "<Name>" --path "<local folder>" [options]

Required:
  --slug <slug>        Kebab-case client id. Must match ${SLUG_RE}
                        (this is C2's SLUG_RE, copied verbatim — the SAME
                        string becomes workspaces.slug, reels.workspace_id,
                        scan_roots.client_id, video_files.client_id and the
                        /api/search client_id param).
  --name "<Name>"      Human display name for the workspaces row.
  --path "<folder>"    Absolute local path to the client's footage folder
                        (becomes the backend scan root's \`path\`).

Options:
  --label "<text>"     Scan-root label sent to POST /api/sources.
                        Defaults to --name.
  --no-recursive       Sets recursive:false in the POST /api/sources body.
                        Default is recursive:true.
  --query "<text>"     Query string used in the STEP 5 verification search.
                        Defaults to "test clip".
  --api-base <url>     Backend base URL. Defaults to ${DEFAULT_API_BASE}.
  --json               Print {steps:[{n,title,kind,payload}]} instead of the
                        human-readable runbook. Machine-parseable.
  --preflight           Perform READ-ONLY checks before printing: a Supabase
                        SELECT for a slug collision, and a backend GET for a
                        path collision. Nothing is written. Requires
                        SUPABASE_URL/VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
                        (same as scripts/migrate.mjs) for the Supabase half;
                        degrades gracefully (prints a notice) if absent.
  --execute             Always hard-refuses (exit 1). This script performs no
                        live writes, ever — see the file header and C8.
  --help                Show this help and exit 0.

Examples:
  node --env-file=.env.local scripts/onboard-client.mjs --slug leroy-crosby --name "Leroy Crosby" --path "C:/Users/Leroy/Videos/leroy finance shorts"
  node --env-file=.env.local scripts/onboard-client.mjs --slug leroy-crosby --name "Leroy Crosby" --path "C:/Users/Leroy/Videos/leroy finance shorts" --preflight
  node --env-file=.env.local scripts/onboard-client.mjs --slug leroy-crosby --name "Leroy Crosby" --path "C:/Users/Leroy/Videos/leroy finance shorts" --json
`;

function parseArgs(argv) {
  const out = {
    recursive: true,
    apiBase: DEFAULT_API_BASE,
    query: "test clip",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--help":
      case "-h":
        out.help = true;
        break;
      case "--json":
        out.json = true;
        break;
      case "--preflight":
        out.preflight = true;
        break;
      case "--execute":
        out.execute = true;
        break;
      case "--no-recursive":
        out.recursive = false;
        break;
      case "--slug":
        out.slug = argv[++i];
        break;
      case "--name":
        out.name = argv[++i];
        break;
      case "--path":
        out.path = argv[++i];
        break;
      case "--label":
        out.label = argv[++i];
        break;
      case "--query":
        out.query = argv[++i];
        break;
      case "--api-base":
        out.apiBase = argv[++i];
        break;
      default:
        console.error(`Unknown argument: ${a}\nRun with --help for usage.`);
        process.exit(1);
    }
  }
  return out;
}

function sqlQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function buildSteps({ slug, name, path, label, recursive, apiBase, query }) {
  return [
    {
      n: 1,
      title: "Insert the workspace directory row (Supabase, requires C4 migration 0115 already applied)",
      kind: "sql",
      payload: {
        target: "Supabase public.workspaces",
        // Matches the C4-frozen runbook INSERT exactly: (slug, name) only —
        // no id column exists (slug is the PK); color is left NULL here.
        sql: `INSERT INTO public.workspaces (slug, name) VALUES (${sqlQuote(slug)}, ${sqlQuote(name)}) ON CONFLICT (slug) DO NOTHING RETURNING slug;`,
        note: "Run via the project's human-gated scoped-migration-style apply (exec_sql), never migrate:apply. Never applied by this script.",
      },
    },
    {
      n: 2,
      title: "Register the scan root with the backend (Team C sources API)",
      kind: "http",
      payload: {
        method: "POST",
        url: `${apiBase}/api/sources`,
        body: { path, label: label || name, recursive, client_id: slug },
        note: "Field names are frozen by C7: {path, label, recursive, client_id} — NOT {name}. Response body's `id` is the scan root id used in STEP 3/4.",
      },
    },
    {
      n: 3,
      title: "Trigger the ingest/scan for the new source",
      kind: "http",
      payload: {
        method: "POST",
        url: `${apiBase}/api/sources/{id}/scan`,
        note: "{id} = the scan root `id` returned by STEP 2's response body. This script never calls this — ingest is never run by build/onboarding agents.",
      },
    },
    {
      n: 4,
      title: "(read-only) Poll for scan completion",
      kind: "http",
      payload: {
        method: "GET",
        url: `${apiBase}/api/sources`,
        note: "Find the new root by path/label and wait for `last_scanned_at` to go non-null (and `is_online:true`) before moving to STEP 5.",
      },
    },
    {
      n: 5,
      title: "Verify the client is searchable and scoped (POST, not GET — C3/C8)",
      kind: "http",
      payload: {
        method: "POST",
        url: `${apiBase}/api/search`,
        body: { query, client_id: slug },
        note: "Confirms scoped search returns this client's footage (and only this client's) once the scan has completed.",
      },
    },
  ];
}

async function runPreflight({ slug, path, apiBase }) {
  console.log("\n--preflight (read-only checks; nothing is written) ------------------\n");

  // 1. Supabase slug collision check (SELECT only).
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log(
      "  [supabase]  skipped — missing SUPABASE_URL (or VITE_SUPABASE_URL) / \n" +
      "              SUPABASE_SERVICE_ROLE_KEY. Run via `node --env-file=.env.local ...`\n" +
      "              to enable this check."
    );
  } else {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data, error } = await supabase
        .from("workspaces")
        .select("slug, name")
        .eq("slug", slug)
        .maybeSingle();
      if (error) {
        console.log(`  [supabase]  could not check (${error.message}) — migration 0115 may not be applied yet.`);
      } else if (data) {
        console.log(`  [supabase]  WARNING: slug '${slug}' already exists as "${data.name}". STEP 1's INSERT will no-op (ON CONFLICT DO NOTHING).`);
      } else {
        console.log(`  [supabase]  OK — slug '${slug}' is not yet taken.`);
      }
    } catch (e) {
      console.log(`  [supabase]  could not check (${e.message})`);
    }
  }

  // 2. Local path existence (offline, no network).
  console.log(
    existsSync(path)
      ? `  [local fs]  OK — path exists: ${path}`
      : `  [local fs]  WARNING: path does not exist on this machine: ${path}`
  );

  // 3. Backend path collision check (GET only).
  try {
    const res = await fetch(`${apiBase}/api/sources`);
    if (!res.ok) {
      console.log(`  [backend]   GET /api/sources returned HTTP ${res.status} — could not check for a path collision.`);
    } else {
      const roots = await res.json();
      const norm = (p) => String(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
      const clash = Array.isArray(roots)
        ? roots.find((r) => norm(r.path) === norm(path))
        : null;
      console.log(
        clash
          ? `  [backend]   WARNING: an existing scan root already uses this path (id ${clash.id}, label "${clash.label ?? ""}"). STEP 2's POST will 400.`
          : "  [backend]   OK — no existing scan root uses this exact path."
      );
    }
  } catch (e) {
    console.log(`  [backend]   could not reach ${apiBase} (${e.message}) — skipped.`);
  }

  console.log("\n-----------------------------------------------------------------------\n");
}

function printHuman(steps) {
  console.log("\nDRY RUN — nothing below is executed. Print-only client-onboarding runbook.\n");
  for (const step of steps) {
    console.log(`STEP ${step.n}: ${step.title}`);
    console.log(`  kind: ${step.kind}`);
    if (step.payload.sql) {
      console.log(`  sql:  ${step.payload.sql}`);
    }
    if (step.payload.method) {
      console.log(`  ${step.payload.method} ${step.payload.url}`);
    }
    if (step.payload.body) {
      console.log(`  body: ${JSON.stringify(step.payload.body)}`);
    }
    if (step.payload.note) {
      console.log(`  note: ${step.payload.note}`);
    }
    if (step.payload.target) {
      console.log(`  target: ${step.payload.target}`);
    }
    console.log("");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(HELP);
    return;
  }

  if (args.execute) {
    console.error(
      "\n--execute is refused.\n\n" +
      "This script never performs a live write, ingest, or deploy — see C8\n" +
      "(cross-team contract) and CLAUDE.md HARD SAFETY RULES 2/3/7. Onboarding\n" +
      "a real client means a human (or the human-gated apply flow) reviews and\n" +
      "runs the printed STEP 1-5 sequence themselves:\n" +
      "  - STEP 1's SQL via the project's scoped, human-run migration-style apply\n" +
      "    (never `migrate:apply`, never this script).\n" +
      "  - STEP 2-3's HTTP calls by hand (curl/Postman/the app), never by an agent.\n" +
      "Re-run without --execute to print the exact steps.\n"
    );
    process.exit(1);
  }

  const missing = ["slug", "name", "path"].filter((k) => !args[k]);
  if (missing.length) {
    console.error(`Missing required argument(s): ${missing.map((m) => `--${m}`).join(", ")}\nRun with --help for usage.`);
    process.exit(1);
  }

  if (!SLUG_RE.test(args.slug)) {
    console.error(`--slug '${args.slug}' fails the canonical SLUG_RE (${SLUG_RE}). 2-40 chars, lowercase kebab-case, must start/end alphanumeric.`);
    process.exit(1);
  }

  const steps = buildSteps(args);

  if (args.preflight) {
    await runPreflight({ slug: args.slug, path: args.path, apiBase: args.apiBase });
  }

  if (args.json) {
    console.log(JSON.stringify({ steps }, null, 2));
  } else {
    printHuman(steps);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
