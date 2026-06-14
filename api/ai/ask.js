/**
 * POST /api/ai/ask
 *
 * RAG-based FAQ bot endpoint. Two call paths:
 *   1. Rocket.Chat bot trigger — message containing @footagebrain-ai.
 *      Authenticated via X-Rocketchat-Token header.
 *      On success, also posts the answer back to the RC channel.
 *   2. Direct dashboard widget (Paul testing the bot).
 *      Authenticated via Bearer JWT.
 *
 * Request:  { question: string, source?: string, channel?: string, author?: string }
 * Response: { answer, confidence, source_type, faq_pair_id, fallback }
 *
 * Confidence tiers:
 *   >= 0.82  direct answer from FAQ (no LLM call)
 *   0.65–0.82  Claude synthesizes using top-3 FAQ pairs as context
 *   < 0.65   graceful fallback — logs unanswered question to ai_notes
 */

import Anthropic from "@anthropic-ai/sdk";
import { adminClient, setCors, parseBody, isAnthropicEnabled } from "../admin/_auth.js";

export const config = { maxDuration: 20 };

const RC_BASE = "https://chat.footagebrain.com";
const DIRECT_THRESHOLD  = 0.82;
const SYNTHESIS_THRESHOLD = 0.65;

// ── Post a message back to Rocket.Chat as the bot user ───────────────────────
async function postToRc(channel, text) {
  const token  = process.env.RC_BOT_TOKEN;
  const userId = process.env.RC_BOT_USER_ID;
  if (!token || !userId) return; // bot not configured — silently skip

  try {
    await fetch(`${RC_BASE}/api/v1/chat.postMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": token,
        "X-User-Id": userId,
      },
      body: JSON.stringify({
        channel: `#${channel}`.replace(/^##/, "#"),
        text,
        alias: "FootageBrain AI",
      }),
    });
  } catch (e) {
    console.error("RC post failed:", e.message);
  }
}

// ── Embed a question via Cohere ───────────────────────────────────────────────
async function embedText(text) {
  const key = (process.env.COHERE_API_KEY || "").replace(/[^\x20-\x7E]/g, "").trim();
  if (!key) throw new Error("COHERE_API_KEY not configured");

  const r = await fetch("https://api.cohere.com/v2/embed", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "embed-english-v3.0",
      texts: [text.trim().slice(0, 8000)],
      input_type: "search_query",
      embedding_types: ["float"],
    }),
  });

  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(`Embedding error: ${r.status} ${err.message || ""}`);
  }
  const data = await r.json();
  const emb  = data.embeddings?.float?.[0];
  if (!Array.isArray(emb)) throw new Error("No embedding returned from Cohere");
  return emb;
}

// ── Synthesize an answer from context pairs using Claude ──────────────────────
async function synthesizeAnswer(question, contextPairs) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const client  = new Anthropic({ apiKey });
  const context = contextPairs
    .map((p, i) => `Q${i + 1}: ${p.question}\nA${i + 1}: ${p.answer}`)
    .join("\n\n");

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 400,
    system: `You are a helpful assistant for a video production team. Answer the user's question
using the FAQ context provided. Be concise (2-4 sentences max). If the context doesn't
fully cover the question, say so and advise the user to check with Paul.
Output plain text only — no markdown, no bullet points.`,
    messages: [{
      role: "user",
      content: `FAQ context:\n${context}\n\nQuestion: ${question}`,
    }],
  });

  return message.content?.[0]?.text || "";
}

// ── Main handler ──────────────────────────────────────────────────────────────
// Also handles ?action=embed (owner-only) so we don't need a separate /api/ai/embed route.
async function handler(req, res) {
  setCors(res, req);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST")   { res.status(405).json({ error: "POST only" }); return; }

  const body = parseBody(req);

  // ── Embed action (FAQ approval flow from ai-brain.jsx) ──────────────────────
  // Server handles both embedding AND the DB update so RLS is never an issue.
  if (body.action === "embed") {
    // Verify the caller has a valid session (no owner DB lookup needed)
    const embedToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (!embedToken) { res.status(401).json({ error: "No auth token" }); return; }
    const { error: authErr } = await adminClient().auth.getUser(embedToken);
    if (authErr) { res.status(401).json({ error: "Invalid token" }); return; }

    const { text, pairId } = body;
    if (!text?.trim()) { res.status(400).json({ error: "text required" }); return; }
    const cohereKey = (process.env.COHERE_API_KEY || "").replace(/[^\x20-\x7E]/g, "").trim();
    if (!cohereKey) { res.status(500).json({ error: "COHERE_API_KEY not configured" }); return; }
    try {
      const r = await fetch("https://api.cohere.com/v2/embed", {
        method: "POST",
        headers: { Authorization: `Bearer ${cohereKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "embed-english-v3.0",
          texts: [text.trim().slice(0, 8000)],
          input_type: "search_document",
          embedding_types: ["float"],
        }),
      });
      if (!r.ok) {
        const errBody = await r.json().catch(() => ({}));
        res.status(500).json({ error: `Embedding error: ${r.status} ${errBody.message || ""}` }); return;
      }
      const d = await r.json();
      const embedding = d.embeddings?.float?.[0];
      if (!Array.isArray(embedding)) { res.status(500).json({ error: "No embedding returned" }); return; }

      // If pairId provided, save embedding + approve server-side via service role (bypasses RLS)
      if (pairId) {
        const embStr = `[${embedding.join(",")}]`;
        const { error: upErr } = await adminClient()
          .from("faq_pairs")
          .update({
            approved: true,
            approved_at: new Date().toISOString(),
            question_embedding: embStr,
          })
          .eq("id", pairId);
        if (upErr) {
          console.error("faq_pairs update error:", upErr.message);
          res.status(500).json({ error: upErr.message }); return;
        }
        res.status(200).json({ ok: true, saved: true });
      } else {
        res.status(200).json({ embedding });
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }

  // ── Auth ───────────────────────────────────────────────────────────────────
  const rcToken    = req.headers["x-rocketchat-token"];
  const authHeader = req.headers.authorization || "";
  const isRcCall   = !!rcToken;

  if (isRcCall) {
    if (rcToken !== process.env.ROCKET_WEBHOOK_SECRET) {
      res.status(401).json({ error: "Invalid webhook token" });
      return;
    }
  } else {
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) { res.status(401).json({ error: "No auth token" }); return; }
    try {
      const sb = adminClient();
      const { error } = await sb.auth.getUser(token);
      if (error) throw error;
    } catch {
      res.status(401).json({ error: "Invalid token" });
      return;
    }
  }

  // ── Parse question ─────────────────────────────────────────────────────────
  // RC webhook shape: { text, channel_name, user_name }
  const question = isRcCall
    ? (body.text || "").replace(/@footagebrain-ai\s*/i, "").trim()
    : (body.question || "").trim();

  const source  = isRcCall ? "rocketchat" : (body.source || "direct");
  const channel = isRcCall ? (body.channel_name || body.channel || "") : (body.channel || "");
  const author  = isRcCall ? (body.user_name || "unknown") : (body.author || "unknown");

  if (!question || question.length < 3) {
    res.status(400).json({ error: "question is required" });
    return;
  }

  const sb = adminClient();
  let answer       = "";
  let confidence   = 0;
  let faqPairId    = null;
  let sourceType   = "fallback";
  let fallback     = false;

  try {
    // ── Embed the question ─────────────────────────────────────────────────
    const embedding = await embedText(question);
    const embeddingStr = `[${embedding.join(",")}]`;
    console.log("ask.js: embedded question, dims=", embedding.length);

    // ── pgvector cosine similarity search ──────────────────────────────────
    const { data: matches, error: searchErr } = await sb.rpc("match_faq_pairs", {
      query_embedding: embeddingStr,
      match_threshold: SYNTHESIS_THRESHOLD,
      match_count: 5,
    });
    console.log("ask.js: rpc result count=", matches?.length, "rpc error=", searchErr?.message);

    // Fallback to a plain SQL query if the RPC doesn't exist yet
    let pairs = matches;
    if (searchErr || !matches) {
      const { data: rawPairs, error: rawErr } = await sb
        .from("faq_pairs")
        .select("id, question, answer, question_embedding")
        .eq("approved", true)
        .limit(200);
      console.log("ask.js: raw fallback rows=", rawPairs?.length, "rawErr=", rawErr?.message);

      // Client-side cosine similarity when pgvector RPC not available
      if (rawPairs && rawPairs.length) {
        const dot    = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
        const norm   = a => Math.sqrt(a.reduce((s, v) => s + v * v, 0));
        const cosSim = (a, b) => dot(a, b) / (norm(a) * norm(b));

        pairs = rawPairs
          .map(p => {
            // Supabase returns vector columns as a JSON string "[0.1,0.2,...]"
            let emb = p.question_embedding;
            if (typeof emb === "string") {
              try { emb = JSON.parse(emb); } catch { emb = null; }
            }
            return { ...p, _emb: emb };
          })
          .filter(p => Array.isArray(p._emb) && p._emb.length === embedding.length)
          .map(p => ({ ...p, similarity: cosSim(embedding, p._emb) }))
          .filter(p => p.similarity >= SYNTHESIS_THRESHOLD)
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, 5);
        console.log("ask.js: client-side matches=", pairs.length, pairs.map(p => ({ q: p.question?.slice(0,40), sim: p.similarity?.toFixed(3) })));
      } else {
        pairs = [];
      }
    }

    const top = pairs?.[0];
    confidence = top?.similarity ?? 0;
    console.log("ask.js: top match=", top?.question?.slice(0,50), "confidence=", confidence);

    if (confidence >= DIRECT_THRESHOLD) {
      // High confidence — use stored answer directly
      answer    = top.answer;
      faqPairId = top.id;
      sourceType = "faq_direct";

      // Increment use_count atomically via SQL
      try {
        await sb.rpc("increment_faq_use_count", { pair_id: top.id });
      } catch (_) {}

    } else if (confidence >= SYNTHESIS_THRESHOLD && pairs?.length) {
      // Medium confidence — synthesize with Claude (unless the owner paused it,
      // in which case we degrade to the graceful fallback below)
      if (!(await isAnthropicEnabled())) {
        console.log("ask.js: Claude paused — skipping synthesis, falling back");
        fallback = true;
      } else try {
        answer     = await synthesizeAnswer(question, pairs.slice(0, 3));
        faqPairId  = top.id;
        sourceType = "faq_synthesized";
        try { await sb.rpc("increment_faq_use_count", { pair_id: top.id }); } catch (_) {}
      } catch (synthErr) {
        console.error("Synthesis failed:", synthErr.message);
        fallback = true;
      }
    } else {
      fallback = true;
    }

  } catch (embedErr) {
    console.error("Embedding failed:", embedErr.message);
    fallback = true;
  }

  // ── Fallback response ──────────────────────────────────────────────────────
  if (fallback || !answer) {
    answer     = "I don't have a confident answer for that — Paul will need to weigh in. Your question has been logged.";
    sourceType = "fallback";
    confidence = 0;
    faqPairId  = null;

    // Log unanswered question to ai_notes so Paul sees it
    try {
      await sb.from("ai_notes").insert({
        source:    source,
        source_id: null,
        channel:   channel || null,
        author:    author,
        body:      question.slice(0, 2000),
        topic:     "Question",
        tags:      ["unanswered"],
        severity:  "low",
      });
    } catch (e) { console.error("ai_notes fallback insert:", e.message); }
  }

  // ── Log the interaction ────────────────────────────────────────────────────
  try {
    await sb.from("bot_conversations").insert({
      source,
      channel:     channel || null,
      author,
      question:    question.slice(0, 2000),
      answer:      answer.slice(0, 4000),
      faq_pair_id: faqPairId,
      confidence:  confidence > 0 ? parseFloat(confidence.toFixed(3)) : null,
    });
  } catch (e) { console.error("bot_conversations insert:", e.message); }

  // ── Post to Rocket.Chat if this came from RC ───────────────────────────────
  if (isRcCall && channel) {
    await postToRc(channel, answer);
  }

  res.status(200).json({
    answer,
    confidence: parseFloat(confidence.toFixed(3)),
    source_type: sourceType,
    faq_pair_id: faqPairId,
    fallback,
  });
}

// Top-level catch ensures any unhandled exception returns JSON (never an HTML 500 page)
export default async function safeHandler(req, res) {
  try {
    await handler(req, res);
  } catch (e) {
    console.error("ask.js unhandled error:", e);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message || "Internal server error" });
    }
  }
}
