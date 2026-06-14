/**
 * Workflow Intelligence Log core (shared module — not a route; underscore-prefixed
 * so Vercel does not count it as a serverless function).
 *
 * Reads recent Rocket.Chat bot_conversations + workflow-relevant ai_notes, asks a
 * free LLM (Gemini Flash via OpenRouter) to distill each into an actionable insight
 * about improving FootageBrain, and stores survivors in workflow_insights.
 *
 * Insights come from the team's Rocket.Chat conversations only — not social channels.
 *
 * Invoked by api/ai/suggest.js when ?action=insights. Auth is performed by the caller.
 *
 * Dedup: skips any item whose source_id already exists in workflow_insights.
 * Hard cap: at most 50 items per run to keep the LLM context bounded.
 */

import { adminClient } from "../admin/_auth.js";

const MAX_ITEMS = 50;

// Gemini Flash first (best free quality), then the shared free fallback chain.
const OR_MODELS = [
  "google/gemini-2.0-flash-exp:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "z-ai/glm-4.5-air:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
];

const SYSTEM = `You are a product analyst for FootageBrain, a video production pipeline dashboard.
You read team chat messages and bot questions and extract insights about how to IMPROVE the
app, its workflow, or the team's process.

Return ONLY a JSON array — no markdown, no text outside JSON. Start with "[".

For each input item that suggests a concrete improvement, output an object:
{
  "source_id": "<the id from the input>",
  "category": "<code_change | workflow_change | feature_request | bug | process>",
  "summary": "<one clear sentence describing the improvement>",
  "tags": ["<tag1>", "<tag2>"],   // 1–3 short tags like "pipeline", "mobile", "capcut"
  "priority": "<low | medium | high>"
}

Category definitions:
- code_change: implies an actual change to the app's code (a bug fix or technical change)
- workflow_change: a change to how work flows through the pipeline/stages
- feature_request: a new capability the team wants
- bug: something is broken (use this over code_change when it's clearly a defect report)
- process: a change to team process, SOP, or coordination (not the app itself)

SKIP items that are just routine questions, greetings, or have no improvement signal —
simply omit them from the array. Only return items worth acting on.`;

async function callOpenRouter(key, userMessage) {
  let lastErr = null;
  for (const model of OR_MODELS) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://footagebrain.com",
          "X-Title": "FootageBrain Workflow Insights",
        },
        body: JSON.stringify({
          model,
          reasoning: { enabled: false },
          max_tokens: 1800,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: userMessage },
          ],
        }),
      });
      if (res.status === 404 || res.status === 429 || res.status === 503) {
        lastErr = new Error(`OR ${res.status} for ${model}`);
        continue;
      }
      if (!res.ok) throw new Error(`OR ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || "";
      if (!text.trim()) { lastErr = new Error(`OR empty from ${model}`); continue; }
      return text;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("All OpenRouter free models failed");
}

function extractJson(text) {
  const start = text.indexOf("[");
  const end   = text.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("No JSON array in LLM response");
  return JSON.parse(text.slice(start, end + 1));
}

const VALID_CATEGORIES = ["code_change", "workflow_change", "feature_request", "bug", "process"];
const VALID_PRIORITIES = ["low", "medium", "high"];

// Runs the full insights pass and writes the HTTP response. Caller must auth first.
export async function runInsights(req, res) {
  const orKey = process.env.OPENROUTER_API_KEY;
  if (!orKey) { res.status(500).json({ error: "OPENROUTER_API_KEY not configured" }); return; }

  const sb = adminClient();
  // Insights come from team conversations in Rocket.Chat, not social channels.
  // Use a 48h window so the team's RC chatter is covered more actively.
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  // ── Gather source items (RC bot questions + workflow-relevant RC notes) ────
  const [convosRes, notesRes] = await Promise.all([
    sb.from("bot_conversations")
      .select("id, question, channel, created_at")
      .eq("source", "rocketchat")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(MAX_ITEMS),
    sb.from("ai_notes")
      .select("id, body, topic, tags, created_at")
      .eq("source", "rocketchat")
      .in("topic", ["Bug", "Improvement", "Process", "SOP", "Question", "Todo"])
      .eq("resolved", false)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(MAX_ITEMS),
  ]);

  if (convosRes.error) { res.status(500).json({ error: convosRes.error.message }); return; }
  if (notesRes.error)  { res.status(500).json({ error: notesRes.error.message });  return; }

  const candidates = [];
  for (const c of (convosRes.data || [])) {
    candidates.push({ id: c.id, source_type: "bot_conversation", text: c.question || "" });
  }
  for (const n of (notesRes.data || [])) {
    candidates.push({ id: n.id, source_type: "ai_note", text: n.body || "" });
  }

  if (!candidates.length) {
    res.status(200).json({ insights_created: 0, insights_skipped: 0, reason: "No Rocket.Chat source items in last 48h" });
    return;
  }

  // ── Dedup: drop items already turned into an insight ───────────────────────
  const ids = candidates.map(c => c.id);
  const { data: existing } = await sb
    .from("workflow_insights")
    .select("source_id")
    .in("source_id", ids);
  const seen = new Set((existing || []).map(e => e.source_id));

  const fresh = candidates.filter(c => !seen.has(c.id)).slice(0, MAX_ITEMS);
  if (!fresh.length) {
    res.status(200).json({ insights_created: 0, insights_skipped: 0, reason: "All recent items already processed" });
    return;
  }

  // Lookup so we can attach source_type + raw_excerpt to whatever the LLM returns.
  const byId = {};
  for (const c of fresh) byId[c.id] = c;

  const userMessage = JSON.stringify(
    fresh.map(c => ({ id: c.id, text: (c.text || "").slice(0, 500) }))
  );

  // ── Parse with the LLM ─────────────────────────────────────────────────────
  let parsed = [];
  try {
    const raw = await callOpenRouter(orKey, userMessage);
    parsed = extractJson(raw);
  } catch (e) {
    console.error("insights LLM error:", e.message);
    res.status(500).json({ error: e.message });
    return;
  }

  // ── Insert survivors ───────────────────────────────────────────────────────
  let created = 0;
  let skipped = 0;
  const rows = [];

  for (const p of parsed) {
    const src = byId[p?.source_id];
    if (!src || !p.summary) { skipped++; continue; }
    const category = VALID_CATEGORIES.includes(p.category) ? p.category : "process";
    const priority = VALID_PRIORITIES.includes(p.priority) ? p.priority : "medium";
    rows.push({
      source_type: src.source_type,
      source_id:   src.id,
      category,
      summary:     String(p.summary).slice(0, 500),
      raw_excerpt: (src.text || "").slice(0, 500),
      tags:        Array.isArray(p.tags) ? p.tags.slice(0, 3) : [],
      priority,
    });
  }

  if (rows.length) {
    const { error } = await sb.from("workflow_insights").insert(rows);
    if (error) {
      console.error("workflow_insights insert error:", error.message);
      res.status(500).json({ error: error.message });
      return;
    }
    created = rows.length;
  }

  res.status(200).json({
    insights_created: created,
    insights_skipped: skipped,
    candidates: fresh.length,
  });
}
