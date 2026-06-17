#!/usr/bin/env node
/**
 * Seed monitor_events from local Obsidian vault notes.
 *
 *   node --env-file=.env.local scripts/seed-monitor-from-obsidian.mjs           # DRY-RUN preview
 *   node --env-file=.env.local scripts/seed-monitor-from-obsidian.mjs --apply   # upsert into Supabase
 *   node --env-file=.env.local scripts/seed-monitor-from-obsidian.mjs --apply --i-know
 *                                                                              # required if NODE_ENV=production
 *
 * Each `.md` file under `obsidian-vault/` becomes one row in `public.monitor_events`
 * with `source_type='vault'` and `external_id=<relative path>`. The Hetzner RSS
 * poller (source_type='poller') and this seed share dedup via the partial
 * unique index `(source_type, external_id) where external_id is not null`, so
 * re-running this script is idempotent.
 *
 * Frontmatter is optional; falls back to (first H1 / first paragraph / file mtime).
 * Schema enums are enforced — invalid `monitor_category` / `severity` values
 * silently downgrade to defaults ('news' / 'info') rather than failing the row.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VAULT_DIR = join(__dirname, "..", "obsidian-vault");

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const args = process.argv.slice(2);
const doApply = args.includes("--apply");
const iKnow   = args.includes("--i-know");

if (doApply && (!url || !key)) {
  console.error(
    "\n  Missing env vars. This script needs SUPABASE_URL (or VITE_SUPABASE_URL)\n" +
    "  and SUPABASE_SERVICE_ROLE_KEY in .env.local.\n\n" +
    "  Run it via:  node --env-file=.env.local scripts/seed-monitor-from-obsidian.mjs --apply\n"
  );
  process.exit(1);
}

// Hard guard: refuse --apply in production unless explicitly acknowledged.
if (doApply && process.env.NODE_ENV === "production" && !iKnow) {
  console.error(
    "\n  Refusing to --apply with NODE_ENV=production.\n" +
    "  Re-run with the --i-know flag if this is intentional.\n"
  );
  process.exit(1);
}

const supabase = doApply
  ? createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

// ── enums (must match supabase/migrations/0059_monitor_events.sql) ───────────
const VALID_CATEGORIES = new Set(["algo", "news"]);
const VALID_SEVERITIES = new Set(["info", "watch", "high"]);
const DEFAULT_CATEGORY = "news";
const DEFAULT_SEVERITY = "info";

// ── frontmatter parser ───────────────────────────────────────────────────────
// Minimal YAML-ish reader: scalar `key: value`, list `key: [a, b]`, and
// indented block list (`- item` lines under a key). Good enough for the
// vault's hand-written notes; not a full YAML implementation.
function parseFrontmatter(text) {
  if (!text.startsWith("---\n")) return { frontmatter: {}, body: text };
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return { frontmatter: {}, body: text };
  const fmRaw = text.slice(4, end);
  const body  = text.slice(end + 5);

  const fm = {};
  const lines = fmRaw.split("\n");
  let currentListKey = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim()) { currentListKey = null; continue; }

    // continuation of a block list
    if (currentListKey && /^\s*-\s+/.test(line)) {
      const item = line.replace(/^\s*-\s+/, "").trim().replace(/^["']|["']$/g, "");
      fm[currentListKey].push(item);
      continue;
    }
    currentListKey = null;

    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2].trim();

    if (val === "") {
      // start of a block list
      fm[key] = [];
      currentListKey = key;
      continue;
    }

    // inline array: [a, b, "c d"]
    if (val.startsWith("[") && val.endsWith("]")) {
      const inner = val.slice(1, -1).trim();
      fm[key] = inner
        ? inner.split(",").map(s => s.trim().replace(/^["']|["']$/g, ""))
        : [];
      continue;
    }

    // strip surrounding quotes on scalars
    fm[key] = val.replace(/^["']|["']$/g, "");
  }

  return { frontmatter: fm, body };
}

// ── derive title / summary from body when frontmatter is absent ──────────────
function deriveFromBody(body) {
  const lines = body.split("\n");
  let firstH1 = null;
  for (const ln of lines) {
    const m = ln.match(/^#\s+(.+?)\s*$/);
    if (m) { firstH1 = m[1].trim(); break; }
  }
  // first non-empty paragraph after the H1 (or from top if no H1)
  let summary = "";
  let inPara = false;
  for (const ln of lines) {
    if (ln.startsWith("#")) continue;
    if (!ln.trim()) {
      if (inPara) break;
      continue;
    }
    summary += (summary ? " " : "") + ln.trim();
    inPara = true;
  }
  summary = summary.slice(0, 500);
  return { firstH1, summary };
}

// ── recursively walk the vault for .md files (skip dotdirs + node_modules) ───
function walkVault(root) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true, recursive: true });
  } catch (e) {
    if (e.code === "ENOENT") {
      console.error(`\n  Vault folder not found: ${root}`);
      console.error("  (obsidian-vault/ is a gitignored junction → set it up first.)\n");
      process.exit(1);
    }
    throw e;
  }

  const files = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    // Dirent.parentPath (Node 20+) or .path (older) — both supported here.
    const parent = ent.parentPath || ent.path || root;
    const full   = join(parent, ent.name);
    const rel    = relative(root, full).replace(/\\/g, "/");
    if (!rel.endsWith(".md")) continue;
    // skip dotfiles and known noisy folders
    if (rel.split("/").some(seg => seg.startsWith(".") || seg === "node_modules")) continue;
    files.push({ full, rel });
  }
  return files.sort((a, b) => a.rel.localeCompare(b.rel));
}

// ── build the monitor_events row for a single .md file ──────────────────────
function buildRow(full, rel) {
  const stat = statSync(full);
  const raw  = readFileSync(full, "utf8");
  const { frontmatter: fm, body } = parseFrontmatter(raw);
  const { firstH1, summary: bodySummary } = deriveFromBody(body);

  const categoryRaw = fm.monitor_category || DEFAULT_CATEGORY;
  const category    = VALID_CATEGORIES.has(categoryRaw) ? categoryRaw : DEFAULT_CATEGORY;

  const severityRaw = fm.severity || DEFAULT_SEVERITY;
  const severity    = VALID_SEVERITIES.has(severityRaw) ? severityRaw : DEFAULT_SEVERITY;

  const tags = Array.isArray(fm.tags) ? fm.tags : [];

  const publishedAt = fm.published_at
    ? new Date(fm.published_at).toISOString()
    : new Date(stat.mtimeMs).toISOString();

  const title   = (fm.title || firstH1 || basename(rel, ".md")).slice(0, 500);
  const summary = (fm.summary || bodySummary || "").slice(0, 500);

  return {
    source_type:  "vault",
    external_id:  rel,
    category,
    platform:     fm.platform ?? null,
    severity,
    status:       "new",
    starred:      false,
    title,
    summary,
    source_name:  fm.source_name ?? null,
    source_url:   fm.source_url  ?? null,
    region:       fm.region      ?? null,
    tags,
    published_at: publishedAt,
    created_by:   null,
  };
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const files = walkVault(VAULT_DIR);
  if (!files.length) {
    console.log("\n  No .md files found under obsidian-vault/. Nothing to seed.\n");
    return;
  }

  const rows = [];
  const skipped = [];
  for (const { full, rel } of files) {
    try {
      rows.push(buildRow(full, rel));
    } catch (e) {
      skipped.push({ rel, reason: e.message });
    }
  }

  // ── DRY-RUN preview ─────────────────────────────────────────────────────
  if (!doApply) {
    console.log("\n  DRY-RUN — no DB writes. Re-run with --apply to upsert.\n");
    console.log("  path                                                  category  severity  title");
    console.log("  ----                                                  --------  --------  -----");
    for (const r of rows) {
      const path  = r.external_id.padEnd(52, " ").slice(0, 52);
      const cat   = r.category.padEnd(8, " ");
      const sev   = r.severity.padEnd(8, " ");
      const title = r.title.slice(0, 60);
      console.log(`  ${path}  ${cat}  ${sev}  ${title}`);
    }
    console.log(`\n  ${rows.length} row(s) ready · ${skipped.length} skipped\n`);
    if (skipped.length) {
      for (const s of skipped) console.log(`    skipped ${s.rel}: ${s.reason}`);
      console.log("");
    }
    return;
  }

  // ── APPLY ──────────────────────────────────────────────────────────────
  console.log(`\n  Upserting ${rows.length} row(s) into monitor_events ...`);

  // ignoreDuplicates:true → existing (source_type, external_id) pairs are no-ops;
  // re-running the seed is safe and won't clobber edits made downstream.
  const { data, error } = await supabase
    .from("monitor_events")
    .upsert(rows, { onConflict: "source_type,external_id", ignoreDuplicates: true })
    .select("external_id");

  if (error) {
    console.error("\n  Upsert failed:", error.message, "\n");
    process.exit(1);
  }

  const inserted = (data || []).length;
  const ignored  = rows.length - inserted;
  console.log(`  ✓ ${inserted} inserted · ${ignored} already present (skipped)\n`);
}

main().catch((e) => {
  console.error("\n  Error:", e.message, "\n");
  process.exit(1);
});
