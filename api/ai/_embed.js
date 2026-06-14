/**
 * POST /api/ai/embed
 *
 * Owner-only. Generates a text-embedding-3-small vector (1536 dims) for a
 * given text string. Used when Paul approves a new FAQ pair so the embedding
 * is stored in faq_pairs.question_embedding for cosine similarity search.
 *
 * Request:  { text: string }
 * Response: { embedding: number[] }  — 1536 floats
 */

import Anthropic from "@anthropic-ai/sdk";
import { adminClient, setCors, parseBody, verifyOwner } from "../admin/_auth.js";

export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  setCors(res, req);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST")   { res.status(405).json({ error: "POST only" }); return; }

  try {
    await verifyOwner(req);
  } catch (e) {
    res.status(e.status || 401).json({ error: e.message });
    return;
  }

  const { text } = parseBody(req);
  if (!text || typeof text !== "string" || !text.trim()) {
    res.status(400).json({ error: "text is required" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
    return;
  }

  try {
    // Anthropic does not yet expose a public embeddings endpoint in the SDK;
    // use OpenAI-compatible embeddings via the raw API.
    // Fallback: use a simple OpenRouter-proxied embedding if Anthropic isn't
    // available — but for now we use the Voyage AI endpoint that Anthropic
    // recommends (voyage-3-lite), which is tiny + cheap.
    //
    // Actually: the most straightforward zero-extra-key approach is to use
    // the OpenAI embeddings endpoint via the user's existing OPENROUTER_API_KEY,
    // which proxies openai/text-embedding-3-small.
    const orKey = process.env.OPENROUTER_API_KEY;
    if (!orKey) {
      res.status(500).json({ error: "OPENROUTER_API_KEY not configured" });
      return;
    }

    const r = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${orKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://footagebrain.com",
        "X-Title": "FootageBrain AI Brain",
      },
      body: JSON.stringify({
        model: "openai/text-embedding-3-small",
        input: text.trim().slice(0, 8000),
      }),
    });

    if (!r.ok) {
      const err = await r.text();
      res.status(500).json({ error: `Embedding API error: ${err.slice(0, 200)}` });
      return;
    }

    const data = await r.json();
    const embedding = data.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) {
      res.status(500).json({ error: "No embedding in response" });
      return;
    }

    res.status(200).json({ embedding });
  } catch (e) {
    console.error("embed error:", e.message);
    res.status(500).json({ error: e.message });
  }
}
