/**
 * POST /api/generate
 *
 * Generates a viral content draft (reel or longform) backed by real
 * FootageBrain footage. Server-side only — Anthropic API key never
 * reaches the browser.
 *
 * Request body:
 *   { prompt: string, type: "reel"|"longform"|"youtube", reel_id?: string }
 *
 * Response:
 *   200 JSON  — structured draft (see DRAFT_SCHEMA below)
 *   400       — missing prompt
 *   500       — upstream error
 */

import Anthropic from "@anthropic-ai/sdk";

const FB_API = "https://api.footagebrain.com/api";
const MAX_SEARCH_CLIPS = 8;    // reduced from 15 — fewer clips = less context = faster
const TRANSCRIPT_CLIPS = 3;    // reduced from 6 — top 3 with transcripts is enough
const MAX_CHUNKS_PER_CLIP = 4; // transcript chunks sent to LLM per clip

// ---------------------------------------------------------------------------
// System prompt — viral content + SEO + hooks specialist
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are a viral short-form content strategist AND video editor for a travel creator.
You receive an idea and a list of real footage clips (with transcript excerpts).

Your job — produce a complete, ready-to-shoot reel package:
- HOOK: a scroll-stopping first line / first 3 seconds. Pattern interrupt, curiosity gap,
  or bold claim. Never generic. This is the single most important field.
- FLOW: a beat-by-beat blueprint (Hook → Build → Payoff → CTA) mapping the reel's structure
  with rough timecodes and what happens in each beat.
- CLIPS: pick the best real clips for each beat. Cite EXACT filenames + tight timecodes from
  the transcript. Never invent footage.
- SEO: a full YouTube/IG title, a complete Instagram caption (with line breaks, emojis, and a
  CTA), a 2-3 sentence SEO description with keywords front-loaded, and 15-20 hashtags
  (mix of broad reach + niche travel tags).

Be specific and usable — an editor should be able to cut this without asking questions.
Output valid JSON only — no markdown, no text outside the JSON. Start with "{".`;

// ---------------------------------------------------------------------------
// Helper: fetch FootageBrain search results
// ---------------------------------------------------------------------------
async function searchFootage(query, n = MAX_SEARCH_CLIPS) {
  const res = await fetch(`${FB_API}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, mode: "semantic", n_results: n }),
  });
  if (!res.ok) throw new Error(`FootageBrain search failed: ${res.status}`);
  const data = await res.json();
  return data.results || [];
}

// ---------------------------------------------------------------------------
// Helper: fetch transcript chunks for a clip (5s timeout)
// ---------------------------------------------------------------------------
async function fetchTranscript(fileId) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${FB_API}/files/${fileId}/transcript`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const chunks = await res.json();
    return Array.isArray(chunks) ? chunks.slice(0, MAX_CHUNKS_PER_CLIP) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Helper: format clips + transcripts into LLM context
// ---------------------------------------------------------------------------
function buildClipContext(clips, transcriptMap) {
  return clips.map((c, i) => {
    const chunks = transcriptMap[c.video_file_id] || [];
    const transcriptText = chunks.length
      ? chunks.map(ch =>
          `  [${fmtTime(ch.start_time)}–${fmtTime(ch.end_time)}] "${ch.text}"`
        ).join("\n")
      : "  (no transcript available)";

    return [
      `CLIP ${i + 1}:`,
      `  id: ${c.video_file_id}`,
      `  filename: ${c.filename}`,
      `  duration: ${c.duration_seconds ? Math.round(c.duration_seconds) + "s" : "unknown"}`,
      `  orientation: ${c.is_vertical ? "vertical" : "horizontal"}`,
      `  drive_url: ${c.drive_url || "not linked"}`,
      `  drive_folder_url: ${c.drive_folder_url || "not linked"}`,
      `  relevance_score: ${c.best_score?.toFixed(3) || "n/a"}`,
      `  transcript_excerpts:`,
      transcriptText,
    ].join("\n");
  }).join("\n\n");
}

function fmtTime(secs) {
  if (secs == null) return "??:??";
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = Math.floor(secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// ---------------------------------------------------------------------------
// JSON schema description sent to the LLM
// ---------------------------------------------------------------------------
function outputSchema(_type) {
  return `{
  "title": "punchy reel title, under 70 chars",
  "description": "one sentence — what this reel is and why it works",
  "hook": "the exact opening line / on-screen text for the first 3 seconds",
  "flow": [
    { "beat": "Hook", "timecode": "0-3s", "direction": "what happens + why it stops the scroll" },
    { "beat": "Build", "timecode": "3-15s", "direction": "..." },
    { "beat": "Payoff", "timecode": "15-40s", "direction": "..." },
    { "beat": "CTA", "timecode": "40-50s", "direction": "..." }
  ],
  "clips": [
    {
      "clip_id": "video_file_id from provided clips",
      "filename": "exact filename",
      "timecode_in": "MM:SS",
      "timecode_out": "MM:SS",
      "drive_url": "from clip data, or null",
      "note": "one-line editor note tying this clip to a beat"
    }
  ],
  "seo": {
    "youtube_title": "SEO title under 70 chars with a curiosity gap",
    "ig_caption": "full Instagram caption with line breaks, emojis, and a CTA at the end",
    "description": "2-3 sentence SEO description, main keyword in the first sentence",
    "hashtags": ["#travel", "#... 15 to 20 total, mix broad + niche"]
  }
}`;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  // CORS for local dev
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  const { prompt, type = "reel", reel_id } = req.body || {};
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY not configured on this server" });
    return;
  }

  try {
    // 1. Search FootageBrain
    const clips = await searchFootage(prompt.trim());
    if (!clips.length) {
      res.status(200).json({ error: "no_footage", message: "No matching footage found in FootageBrain for this prompt." });
      return;
    }

    // 2. Fetch transcripts for top N clips in parallel
    const topClips = clips.slice(0, TRANSCRIPT_CLIPS);
    const transcripts = await Promise.all(topClips.map(c => fetchTranscript(c.video_file_id)));
    const transcriptMap = {};
    topClips.forEach((c, i) => { transcriptMap[c.video_file_id] = transcripts[i]; });

    // Include remaining clips (no transcripts) for context
    const allContextClips = clips; // all 15
    const clipContext = buildClipContext(allContextClips, transcriptMap);

    // 3. Build user message
    const userMessage = `Reel idea: "${prompt.trim()}"

Available footage (${clips.length} clips):

${clipContext}

Pick the best clips for this reel. Only use clips from the list above.
Return a single JSON object matching this schema exactly — nothing else:

${outputSchema(type)}`;

    // 4. Call Anthropic
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    // 5. Parse JSON from response — robustly. The model occasionally wraps
    //    output in ```json fences or adds a stray prefix; strip those first.
    const rawText = message.content?.[0]?.text || "";
    let draft;
    try {
      let txt = rawText.trim();
      // Strip markdown code fences if present
      txt = txt.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
      const jsonStart = txt.indexOf("{");
      const jsonEnd = txt.lastIndexOf("}") + 1;
      if (jsonStart === -1 || jsonEnd <= jsonStart) throw new Error("no JSON object found");
      draft = JSON.parse(txt.slice(jsonStart, jsonEnd));
    } catch (parseErr) {
      // Last resort: return a minimal valid shape so the UI never shows a
      // "Generated reel" fallback with empty everything.
      draft = {
        title: `Reel: ${prompt.slice(0, 50)}`,
        description: "(AI response could not be parsed — try Regenerate)",
        clips: [],
        _raw: rawText,
        _parse_error: parseErr.message,
      };
    }

    // 6. Inject drive_url + drive_folder_url from real search results —
    //    don't trust the LLM to reliably copy URLs out of the context.
    if (draft && Array.isArray(draft.clips)) {
      const byId = Object.fromEntries(clips.map(c => [c.video_file_id, c]));
      draft.clips = draft.clips.map(clip => {
        const src = byId[clip.clip_id] || {};
        return {
          ...clip,
          drive_url: src.drive_url || clip.drive_url || null,
          drive_folder_url: src.drive_folder_url || clip.drive_folder_url || null,
          thumbnail_path: src.thumbnail_path || null,
          duration_seconds: src.duration_seconds || null,
          is_vertical: src.is_vertical ?? clip.is_vertical ?? false,
        };
      });
    }

    res.status(200).json({
      draft,
      prompt,
      meta: {
        clips_searched: clips.length,
        clips_with_transcripts: topClips.length,
        input_tokens: message.usage?.input_tokens,
        output_tokens: message.usage?.output_tokens,
      },
    });

  } catch (err) {
    console.error("generate error:", err);
    res.status(500).json({ error: err.message || "generation failed" });
  }
}
