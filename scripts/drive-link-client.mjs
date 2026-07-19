#!/usr/bin/env node
/**
 * Drive-link runner — a DOCUMENTED SCAFFOLD, not a live run.
 *
 *   node --env-file=.env.local scripts/drive-link-client.mjs --slug leroy-crosby
 *   node --env-file=.env.local scripts/drive-link-client.mjs --slug leroy-crosby --json
 *   node --env-file=.env.local scripts/drive-link-client.mjs --slug leroy-crosby --preflight
 *   node --env-file=.env.local scripts/drive-link-client.mjs --help
 *
 * WHAT THIS PRINTS (never performs): the steps to attach Google Drive
 * `webViewLink`s to one client's LOCAL video_files rows, by REUSING the
 * existing Python Drive-crawl toolkit already on disk at:
 *
 *   E:/Users/Mi/Downloads/files/footage-brain/footage-brain-test/Google drive api code/
 *   (credentials.json, reauth_drive.py, list_all_drive_videos.py)
 *
 * This file is plain Node/JS and adds NO googleapis / google-auth-library
 * dependency — it never calls the Drive API itself, it documents the
 * existing Python toolkit's re-use. A human runs the Python scripts and
 * reviews the generated SQL before ever executing it.
 *
 * SCOPING (hard requirement, C8): every list/match/UPDATE in this runbook is
 * filtered to ONE client (--slug) at a time. Matching is NEVER attempted
 * across the whole video_files table — two different clients can legally
 * have a same-named clip, and a global match would silently cross-attach
 * the wrong Drive link to the wrong client's row.
 *
 * DRY-RUN ALWAYS (C8): zero Drive API calls, zero `.update`/`.upsert`/`.rpc`,
 * zero live POSTs anywhere in this file. `--execute` hard-refuses (exit 1).
 * `--preflight` performs ONLY read-only local fs checks (does the toolkit
 * folder / credentials.json exist on this machine) and a read-only GET
 * against the backend to confirm it's reachable — no Drive call, no write.
 *
 * KNOWN GAP (verified against backend/app/db/models.py at build time,
 * per C8): public.video_files (Hetzner Postgres backend, NOT Supabase) has
 * a `drive_url` column (String(2048), nullable) but NO md5/checksum column.
 * Matching below is therefore filename + file_size only; a same-client
 * filename+size collision needs manual disambiguation before any UPDATE.
 */

import { existsSync } from "node:fs";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

const DEFAULT_API_BASE = "https://api.footagebrain.com";
const DEFAULT_TOOLKIT_DIR =
  "E:/Users/Mi/Downloads/files/footage-brain/footage-brain-test/Google drive api code";
const DEFAULT_FOLDER_ID = "1Dp24NVj4uD5q2V9pvVozZ2cewK46qcla";

const HELP = `
drive-link-client.mjs — documented scaffold (NOT a live run)

Usage:
  node --env-file=.env.local scripts/drive-link-client.mjs --slug <slug> [options]

Required:
  --slug <slug>          Client id to scope every step to. Must match
                          ${SLUG_RE} (C2's SLUG_RE, copied verbatim).

Options:
  --folder-id <id>       Target Drive folder id. Defaults to the frozen
                          folder id ${DEFAULT_FOLDER_ID}.
  --toolkit-dir "<path>"  Path to the reused Python Drive toolkit.
                          Defaults to:
                          ${DEFAULT_TOOLKIT_DIR}
  --api-base <url>       Backend base URL. Defaults to ${DEFAULT_API_BASE}.
  --json                 Print {steps:[{n,title,kind,payload}]} instead of
                          the human-readable runbook. Machine-parseable.
  --preflight             Perform READ-ONLY checks before printing: confirm
                          the toolkit folder + credentials.json exist on
                          this machine, and that the backend responds to a
                          GET. No Drive call, no DB write.
  --execute               Always hard-refuses (exit 1). This script performs
                          no live Drive calls or DB writes, ever.
  --help                  Show this help and exit 0.

Examples:
  node --env-file=.env.local scripts/drive-link-client.mjs --slug leroy-crosby
  node --env-file=.env.local scripts/drive-link-client.mjs --slug leroy-crosby --preflight
  node --env-file=.env.local scripts/drive-link-client.mjs --slug leroy-crosby --json
`;

function parseArgs(argv) {
  const out = {
    apiBase: DEFAULT_API_BASE,
    toolkitDir: DEFAULT_TOOLKIT_DIR,
    folderId: DEFAULT_FOLDER_ID,
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
      case "--slug":
        out.slug = argv[++i];
        break;
      case "--folder-id":
        out.folderId = argv[++i];
        break;
      case "--toolkit-dir":
        out.toolkitDir = argv[++i];
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

function buildSteps({ slug, folderId, toolkitDir, apiBase }) {
  return [
    {
      n: 1,
      title: "Reuse the existing Drive OAuth client — do not create a new Google Cloud project",
      kind: "manual",
      payload: {
        dir: toolkitDir,
        note: "Keep credentials.json as-is from this folder. It already carries the OAuth client used by list_all_drive_videos.py / reauth_drive.py.",
      },
    },
    {
      n: 2,
      title: "Delete token.json and re-auth as the owner's Google account (drive.metadata.readonly)",
      kind: "manual",
      payload: {
        commands: [
          `cd "${toolkitDir}"`,
          "del token.json    # (PowerShell/cmd)  |  rm token.json  (bash)",
          "python reauth_drive.py    # opens a browser consent screen; writes a fresh token.json",
        ],
        note: "reauth_drive.py's SCOPES = ['https://www.googleapis.com/auth/drive.metadata.readonly'] — read-only metadata, no file-content access, no write scope. Must be run interactively by a human (browser consent).",
      },
    },
    {
      n: 3,
      title: "List the target Drive folder",
      kind: "manual",
      payload: {
        folderId,
        driveQuery: `'${folderId}' in parents and trashed=false`,
        fields: ["id", "name", "size", "webViewLink", "md5Checksum"],
        note: "Extend/run list_all_drive_videos.py's existing `service.files().list(...)` call scoped with the query above (or filter its full-Drive drive_videos.csv crawl down to descendants of this folder id). md5Checksum is requested from Drive for future-proofing even though the local side has no matching column yet (see KNOWN GAP).",
      },
    },
    {
      n: 4,
      title: `Pull the LOCAL clip list for '${slug}' ONLY (client_id-scoped at the DB layer, never global)`,
      kind: "http",
      payload: {
        method: "POST",
        url: `${apiBase}/api/search`,
        body: { query: "", client_id: slug, n_results: 200, offset: 0 },
        note: "Empty `query` hits the backend's browse funnel; SearchFilters.client_id applies directly to video_files.client_id (C3/C7), so results are authoritative and already scoped to this client. Paginate `offset` by 200 until results.length < n_results. Collect {video_file_id, filename} per result.",
      },
    },
    {
      n: 5,
      title: "Backfill file_size per candidate (read-only)",
      kind: "http",
      payload: {
        method: "GET",
        url: `${apiBase}/api/files/{video_file_id}`,
        note: "SearchResultOut (STEP 4's response shape) has no file_size field, so fetch it per id from GET /api/files/{id} (VideoFileOut.file_size). KNOWN GAP: video_files has no md5/checksum column as of this build (verified against backend/app/db/models.py) — matching uses filename + file_size only.",
      },
    },
    {
      n: 6,
      title: `Match name+size within '${slug}'s candidate list against the Drive listing — never across clients`,
      kind: "manual",
      payload: {
        rule: "Drive item.name === local.filename AND Drive item.size === local.file_size, matched ONLY within this client's STEP 4/5 candidate list.",
        note: "A same-client filename+size collision (two candidates matching one Drive item, or vice versa) must be resolved by a human opening both clips before any UPDATE is written — do not guess.",
      },
    },
    {
      n: 7,
      title: "Emit the scoped UPDATE per confirmed match (human-run — NOT executed by this script)",
      kind: "sql",
      payload: {
        target: "Backend's own Hetzner Postgres (video_files) — NOT Supabase, NOT exec_sql/migrate.mjs",
        sqlTemplate:
          `UPDATE video_files\n` +
          `SET drive_url = '<webViewLink>'\n` +
          `WHERE id = '<video_file_id>'\n` +
          `  AND client_id = ${sqlQuote(slug)};`,
        note: "id = the video_file_id from STEP 4 (never a bare filename WHERE) + AND client_id='<slug>' on every statement closes the collision risk even if two clients happen to share a filename. Never a global UPDATE.",
      },
    },
  ];
}

async function runPreflight({ toolkitDir, apiBase }) {
  console.log("\n--preflight (read-only checks; nothing is written, no Drive call) -----\n");

  const credsPath = `${toolkitDir}/credentials.json`;
  const tokenPath = `${toolkitDir}/token.json`;
  console.log(
    existsSync(toolkitDir)
      ? `  [local fs]  OK — toolkit folder found: ${toolkitDir}`
      : `  [local fs]  WARNING: toolkit folder not found: ${toolkitDir} (pass --toolkit-dir to override)`
  );
  console.log(
    existsSync(credsPath)
      ? "  [local fs]  OK — credentials.json present."
      : "  [local fs]  WARNING: credentials.json not found — STEP 2 cannot run without it."
  );
  console.log(
    existsSync(tokenPath)
      ? "  [local fs]  token.json present (STEP 2 deletes and regenerates this)."
      : "  [local fs]  token.json absent — STEP 2's re-auth will create it fresh."
  );

  try {
    const res = await fetch(`${apiBase}/api/search/modes`);
    console.log(
      res.ok
        ? `  [backend]   OK — ${apiBase} is reachable (GET /api/search/modes -> ${res.status}).`
        : `  [backend]   ${apiBase} responded HTTP ${res.status} to GET /api/search/modes.`
    );
  } catch (e) {
    console.log(`  [backend]   could not reach ${apiBase} (${e.message}) — skipped.`);
  }

  console.log("\n-----------------------------------------------------------------------\n");
}

function printHuman(steps) {
  console.log("\nDOCUMENTED SCAFFOLD — nothing below is executed. No Drive call, no DB write.\n");
  for (const step of steps) {
    console.log(`STEP ${step.n}: ${step.title}`);
    console.log(`  kind: ${step.kind}`);
    if (step.payload.dir) console.log(`  dir:  ${step.payload.dir}`);
    if (step.payload.commands) {
      console.log("  commands:");
      for (const c of step.payload.commands) console.log(`    ${c}`);
    }
    if (step.payload.folderId) console.log(`  folderId: ${step.payload.folderId}`);
    if (step.payload.driveQuery) console.log(`  driveQuery: ${step.payload.driveQuery}`);
    if (step.payload.fields) console.log(`  fields: ${step.payload.fields.join(", ")}`);
    if (step.payload.method) console.log(`  ${step.payload.method} ${step.payload.url}`);
    if (step.payload.body) console.log(`  body: ${JSON.stringify(step.payload.body)}`);
    if (step.payload.rule) console.log(`  rule: ${step.payload.rule}`);
    if (step.payload.target) console.log(`  target: ${step.payload.target}`);
    if (step.payload.sqlTemplate) console.log(`  sql:\n    ${step.payload.sqlTemplate.replace(/\n/g, "\n    ")}`);
    if (step.payload.note) console.log(`  note: ${step.payload.note}`);
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
      "This script never calls the Drive API and never writes to video_files —\n" +
      "see C8 (cross-team contract) and CLAUDE.md HARD SAFETY RULES 3/4. It only\n" +
      "documents the human-run sequence: re-auth via reauth_drive.py, list the\n" +
      "Drive folder, match within one client's footage, then a human reviews\n" +
      "and runs the generated UPDATE against the backend's own Postgres.\n" +
      "Re-run without --execute to print the exact steps.\n"
    );
    process.exit(1);
  }

  if (!args.slug) {
    console.error("Missing required argument: --slug\nRun with --help for usage.");
    process.exit(1);
  }

  if (!SLUG_RE.test(args.slug)) {
    console.error(`--slug '${args.slug}' fails the canonical SLUG_RE (${SLUG_RE}). 2-40 chars, lowercase kebab-case, must start/end alphanumeric.`);
    process.exit(1);
  }

  const steps = buildSteps(args);

  if (args.preflight) {
    await runPreflight({ toolkitDir: args.toolkitDir, apiBase: args.apiBase });
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
