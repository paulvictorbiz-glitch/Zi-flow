/**
 * POST /api/ai/monitor
 *
 * Classifies a batch of messages (from Rocket.Chat webhook or social inbox)
 * into topics and stores tagged notes in Supabase.
 *
 * Two call paths:
 *   1. Rocket.Chat outgoing webhook — authenticated via X-Rocketchat-Token header.
 *      Payload is RC's native shape: { token, channel_name, user_name, text, ... }
 *   2. Frontend (inbox.jsx classify-only) — authenticated via Bearer JWT.
 *      Payload: { messages: [{id, source, channel, author, body}], classify_only: true }
 *
 * When classify_only=true: returns { classifications: {[id]: {topic,tags,severity}} }
 * without writing to Supabase (used for inbox tag badges — prevents duplicate notes
 * when the inbox refreshes repeatedly).
 *
 * Otherwise: inserts into ai_notes and returns { processed, notes_created }.
 */

import { adminClient, setCors, parseBody } from "../admin/_auth.js";

export const config = { maxDuration: 30 };

// ── OpenRouter free model fallback chain (copied from api/generate.js pattern) ──
const OR_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "z-ai/glm-4.5-air:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "openai/gpt-oss-120b:free",
  "moonshotai/kimi-k2.6:free",
];

let lastWorkingModel = null;

function modelOrder() {
  if (lastWorkingModel && OR_MODELS.includes(lastWorkingModel)) {
    return [lastWorkingModel, ...OR_MODELS.filter(m => m !== lastWorkingModel)];
  }
  return OR_MODELS;
}

async function callOpenRouter(key, system, userMessage, maxTokens = 1200) {
  let lastErr = null;
  for (const model of modelOrder()) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://footagebrain.com",
          "X-Title": "FootageBrain AI Monitor",
        },
        body: JSON.stringify({
          model,
          reasoning: { enabled: false },
          max_tokens: maxTokens,
          messages: [
            { role: "system", content: system },
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
      lastWorkingModel = model;
      return text;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("All OpenRouter free models failed");
}

// ── Classification system prompt ─────────────────────────────────────────────
const SYSTEM = `You are a message classifier for a video production team dashboard.
Classify each message and return ONLY a JSON array — no markdown, no text outside JSON.

For each message output an object:
{
  "id": "<message id>",
  "topic": "<one of: SOP | Process | Bug | Question | Todo | Improvement | Other>",
  "tags": ["<tag1>", "<tag2>"],   // 0–3 short freeform tags like "posting-schedule", "capcut", "workflow"
  "severity": "<low | medium | high>",
  "faq_candidate": <true|false>   // true only if the message is a question AND an answer is inferable
}

Topic definitions:
- SOP: discusses a standard operating procedure, a rule, or a repeatable step-by-step process
- Process: discusses workflow, pipeline stages, production flow, or how something is done
- Bug: reports a broken feature, error, or something not working
- Question: asks for information, help, or clarification
- Todo: a task, reminder, or action item
- Improvement: suggests making something better, faster, or easier
- Other: everything else (greetings, off-topic, short reactions)

Severity:
- high: blocking production, urgent, or a critical error
- medium: affects workflow or multiple people
- low: minor, informational, or routine

Return the array only. Start with "[".`;

// ── Normalise a Rocket.Chat native webhook payload into our message shape ─────
function normaliseRcWebhook(body) {
  return [{
    id: body.message_id || `rc_${Date.now()}`,
    source: "rocketchat",
    channel: body.channel_name || body.channel || "unknown",
    author: body.user_name || body.user?.username || "unknown",
    body: (body.text || "").slice(0, 2000),
  }];
}

// ── Extract JSON array from LLM text (handles stray markdown fences) ─────────
function extractJson(text) {
  const start = text.indexOf("[");
  const end   = text.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("No JSON array in LLM response");
  return JSON.parse(text.slice(start, end + 1));
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  setCors(res, req);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST")   { res.status(405).json({ error: "POST only" }); return; }

  const body = parseBody(req);

  // ── Determine call path ────────────────────────────────────────────────────
  // RC outgoing webhook sends X-Rocketchat-Token. Frontend sends Bearer JWT.
  const rcToken    = req.headers["x-rocketchat-token"];
  const authHeader = req.headers.authorization || "";
  const isRcCall   = !!rcToken;

  if (isRcCall) {
    const expected = process.env.ROCKET_WEBHOOK_SECRET;
    if (!expected || rcToken !== expected) {
      res.status(401).json({ error: "Invalid webhook token" });
      return;
    }
  } else {
    // Frontend calls must send a valid Bearer JWT — we accept any authenticated user
    // (not owner-only) since inbox.jsx classify_only calls come from all users.
    // We do NOT call verifyOwner here; a lightweight JWT check suffices.
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      res.status(401).json({ error: "No auth token" });
      return;
    }
    try {
      const sb = adminClient();
      const { error } = await sb.auth.getUser(token);
      if (error) throw error;
    } catch {
      res.status(401).json({ error: "Invalid token" });
      return;
    }
  }

  // ── Build message list ─────────────────────────────────────────────────────
  let messages;
  if (isRcCall) {
    messages = normaliseRcWebhook(body);
  } else {
    messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) {
      res.status(200).json({ processed: 0, notes_created: 0, classifications: {} });
      return;
    }
  }

  const classifyOnly = !isRcCall && !!body.classify_only;

  // Filter out bot messages and very short noise (reactions, single-word replies)
  const filterable = messages.filter(m => {
    const t = (m.body || "").trim();
    return t.length > 8 && !/^@footagebrain-ai/i.test(t);
  });

  if (!filterable.length) {
    res.status(200).json({ processed: 0, notes_created: 0, classifications: {} });
    return;
  }

  // ── Classify ───────────────────────────────────────────────────────────────
  const orKey = process.env.OPENROUTER_API_KEY;
  if (!orKey) {
    res.status(500).json({ error: "OPENROUTER_API_KEY not configured" });
    return;
  }

  const userMessage = JSON.stringify(
    filterable.map(m => ({ id: m.id, body: (m.body || "").slice(0, 500) }))
  );

  let classifications = [];
  try {
    const raw = await callOpenRouter(orKey, SYSTEM, userMessage, 1200);
    classifications = extractJson(raw);
  } catch (e) {
    console.error("AI monitor classification failed:", e.message);
    // Graceful degradation — return empty rather than 500 so inbox doesn't break
    res.status(200).json({ processed: 0, notes_created: 0, classifications: {} });
    return;
  }

  // Build a lookup by id
  const byId = {};
  for (const c of classifications) {
    if (c && c.id) byId[c.id] = c;
  }

  if (classifyOnly) {
    // Return classifications without DB writes (inbox refresh path)
    const out = {};
    for (const [id, c] of Object.entries(byId)) {
      out[id] = { topic: c.topic || "Other", tags: c.tags || [], severity: c.severity || "low" };
    }
    res.status(200).json({ classifications: out });
    return;
  }

  // ── Persist to ai_notes ────────────────────────────────────────────────────
  const sb = adminClient();
  const rows = [];

  for (const msg of filterable) {
    const c = byId[msg.id] || {};
    const topic = c.topic || "Other";
    if (topic === "Other") continue; // don't clutter the notes log with noise

    rows.push({
      source:    msg.source || "rocketchat",
      source_id: msg.id,
      channel:   msg.channel || null,
      author:    msg.author || null,
      body:      (msg.body || "").slice(0, 2000),
      topic,
      tags:      Array.isArray(c.tags) ? c.tags.slice(0, 5) : [],
      severity:  c.severity || "low",
    });
  }

  let notesCreated = 0;
  let insertedNotes = [];
  if (rows.length) {
    const { data, error } = await sb.from("ai_notes").insert(rows).select("id, source, body, topic, tags, severity");
    if (error) console.error("ai_notes insert error:", error.message);
    else { notesCreated = rows.length; insertedNotes = data || []; }
  }

  // ── Immediate workflow_insights write for high-severity notes ──────────────
  // Urgent bugs shouldn't wait for the daily /api/ai/insights cron. Mirror any
  // high-severity note straight into the insights log so it surfaces right away.
  // Insights only come from team Rocket.Chat conversations — not social channels.
  const urgent = insertedNotes.filter(n => n.severity === "high" && (n.source || "rocketchat") === "rocketchat");
  if (urgent.length) {
    const insightRows = urgent.map(n => ({
      source_type: "ai_note",
      source_id:   n.id,
      category:    n.topic === "Bug" ? "bug" : "process",
      summary:     (n.body || "").slice(0, 200),
      raw_excerpt: (n.body || "").slice(0, 500),
      tags:        Array.isArray(n.tags) ? n.tags.slice(0, 3) : [],
      priority:    "high",
    }));
    const { error: insErr } = await sb.from("workflow_insights").insert(insightRows);
    if (insErr) console.error("workflow_insights (high-severity) insert error:", insErr.message);
  }

  res.status(200).json({
    processed:     filterable.length,
    notes_created: notesCreated,
  });
}
