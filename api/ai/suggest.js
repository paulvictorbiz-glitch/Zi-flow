/**
 * GET  /api/ai/suggest?secret=<SUGGEST_CRON_SECRET>
 *   Triggered daily by a Hetzner cron job. Reviews the last 7 days of unresolved
 *   ai_notes, identifies recurring patterns, and generates up to 3 improvement
 *   suggestions stored in improvement_suggestions.
 *   Deduplicates against existing suggestions (same title within 14 days → skip).
 *
 * GET/POST /api/ai/suggest?action=insights
 *   Workflow Intelligence Log pass — distills recent Rocket.Chat conversations
 *   into workflow_insights (see _insights-core.js). Triggered by the AI Brain
 *   "Parse now" button (Bearer JWT) or a daily cron (secret). Uses a free
 *   OpenRouter model, so it is NOT gated by the Anthropic kill switch.
 *
 * Both actions share SUGGEST_CRON_SECRET. Folded into one route to stay under the
 * Vercel Hobby 12-function limit.
 *
 * Setup on Hetzner host (crontab -e):
 *   0  8 * * * curl -s "https://footagebrain.com/api/ai/suggest?secret=YOUR_SECRET" > /dev/null
 *   30 8 * * * curl -s "https://footagebrain.com/api/ai/suggest?action=insights&secret=YOUR_SECRET" > /dev/null
 */

import Anthropic from "@anthropic-ai/sdk";
import { adminClient, setCors, isAnthropicEnabled, ANTHROPIC_PAUSED } from "../admin/_auth.js";
import { runInsights } from "./_insights-core.js";
import { ingestSources } from "./_rss.js";

export const config = { maxDuration: 45 };

export default async function handler(req, res) {
  setCors(res, req);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const url = req.url && new URL(req.url, "https://footagebrain.com");
  const action = req.query?.action || url?.searchParams.get("action");
  const secret = req.query?.secret || url?.searchParams.get("secret");

  // ── Auth: cron secret (query) OR owner Bearer JWT ──────────────────────────
  let authed = !!secret && secret === process.env.SUGGEST_CRON_SECRET;
  if (!authed) {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (token) {
      try {
        const { error } = await adminClient().auth.getUser(token);
        if (!error) authed = true;
      } catch { /* fall through */ }
    }
  }
  if (!authed) { res.status(401).json({ error: "Unauthorized" }); return; }

  // ── Dispatch: insights pass lives in the shared core module (free model) ───
  if (action === "insights") {
    return runInsights(req, res);
  }

  // ── Dispatch: news-monitor RSS ingest (free model; not Anthropic-gated) ────
  // Triggered by the Pulse "Refresh now" button (Bearer JWT) or a Hetzner cron
  // (secret): */30 * * * * curl ".../api/ai/suggest?action=news-ingest&secret=…"
  if (action === "news-ingest") {
    try {
      const summary = await ingestSources(adminClient());
      res.status(200).json({ ok: true, ...summary });
    } catch (e) {
      console.error("news-ingest error:", e.message);
      res.status(500).json({ error: e.message });
    }
    return;
  }

  // ── Kill switch: skip the suggestions run if the owner paused Claude ────────
  if (!(await isAnthropicEnabled())) { res.status(503).json(ANTHROPIC_PAUSED); return; }

  const sb = adminClient();

  // ── Fetch last 7 days of unresolved notes ─────────────────────────────────
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: notes, error: notesErr } = await sb
    .from("ai_notes")
    .select("id, source, topic, tags, body, severity, created_at")
    .eq("resolved", false)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(200);

  if (notesErr) {
    res.status(500).json({ error: notesErr.message });
    return;
  }

  if (!notes || notes.length === 0) {
    res.status(200).json({ suggestions_created: 0, suggestions_skipped: 0, reason: "No unresolved notes in last 7 days" });
    return;
  }

  // ── Build context string (no raw message bodies — just metadata + excerpts) ─
  const grouped = {};
  for (const n of notes) {
    if (!grouped[n.topic]) grouped[n.topic] = [];
    grouped[n.topic].push({
      tags:    n.tags,
      excerpt: (n.body || "").slice(0, 120),
      source:  n.source,
    });
  }

  const contextLines = Object.entries(grouped).map(([topic, items]) =>
    `${topic} (${items.length} occurrences):\n` +
    items.slice(0, 6).map(it =>
      `  - [${it.source}] ${it.excerpt}` + (it.tags?.length ? ` [${it.tags.join(", ")}]` : "")
    ).join("\n")
  );

  const contextText = contextLines.join("\n\n");

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
    return;
  }

  // ── Ask Claude for improvement suggestions ────────────────────────────────
  let suggestions = [];
  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: `You are an operations advisor for a 4-person video production team called FootageBrain.
You analyze recurring patterns in team chat and social media comments to identify workflow improvements.
Return ONLY a JSON array of up to 3 suggestions. No markdown, no text outside JSON. Start with "[".

Each suggestion:
{
  "category": "<workflow | app | content | sop>",
  "title": "<short action-oriented title, max 80 chars>",
  "body": "<2-3 sentence explanation of the issue and recommended fix>",
  "priority": "<low | medium | high>"
}

Categories:
- workflow: how the team coordinates, assigns tasks, or follows processes
- app: the FootageBrain dashboard app — missing features, UX issues, bugs
- content: video content strategy, posting schedules, platform-specific advice
- sop: standard operating procedure gaps — things that need to be documented`,
      messages: [{
        role: "user",
        content: `Here are the recurring themes from team conversations in the last 7 days:\n\n${contextText}\n\nGenerate up to 3 actionable improvement suggestions.`,
      }],
    });

    const raw = message.content?.[0]?.text || "";
    const start = raw.indexOf("[");
    const end   = raw.lastIndexOf("]");
    if (start !== -1 && end !== -1) {
      suggestions = JSON.parse(raw.slice(start, end + 1));
    }
  } catch (e) {
    console.error("suggest LLM error:", e.message);
    res.status(500).json({ error: e.message });
    return;
  }

  if (!suggestions.length) {
    res.status(200).json({ suggestions_created: 0, suggestions_skipped: 0 });
    return;
  }

  // ── Deduplicate against recent suggestions ────────────────────────────────
  const since14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: existing } = await sb
    .from("improvement_suggestions")
    .select("title")
    .gte("created_at", since14);

  const existingTitles = new Set((existing || []).map(s => s.title.toLowerCase().trim()));

  let created = 0;
  let skipped = 0;

  for (const s of suggestions) {
    if (!s.title || !s.body || !s.category) { skipped++; continue; }
    if (existingTitles.has(s.title.toLowerCase().trim())) { skipped++; continue; }

    const { error } = await sb.from("improvement_suggestions").insert({
      category: s.category || "workflow",
      title:    s.title.slice(0, 200),
      body:     s.body.slice(0, 2000),
      priority: s.priority || "medium",
      source_note_ids: notes.slice(0, 10).map(n => n.id),
    });

    if (error) {
      console.error("suggestion insert error:", error.message);
      skipped++;
    } else {
      created++;
    }
  }

  res.status(200).json({ suggestions_created: created, suggestions_skipped: skipped });
}
