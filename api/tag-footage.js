/**
 * POST /api/tag-footage
 *
 * Analyze a clip's thumbnail frame with a free OpenRouter vision model and
 * return structured tags so footage can be searched/browsed by what's visually
 * on screen (objects, scenes, activities, mood, setting).
 *
 * Body:  { footage_file_id, thumbnail_url, filename }
 *        thumbnail_url is the backend path (e.g. "frame_0001.jpg" or a path
 *        with a directory prefix) — we keep only the basename and fetch it from
 *        FootageBrain's /thumbnails endpoint.
 * Reply: { tags: { objects[], scenes[], activities[], mood[], setting[], tagged_at } , model }
 *
 * Uses OPENROUTER_API_KEY (already configured for /api/generate). No new key.
 */

// FootageBrain origin to fetch the raw thumbnail from (server-side, so we hit
// the API subdomain directly — the /fb proxy is a browser-only convenience).
const FB_ORIGIN = process.env.FB_PROXY_TARGET || "https://api.footagebrain.com";

// Free OpenRouter VISION models, tried in order. Free slugs get saturated /
// retired over time — keep this fresh against
// https://openrouter.ai/api/v1/models (filter for ":free" + image input).
const OPENROUTER_VISION_MODELS = [
  "meta-llama/llama-3.2-11b-vision-instruct:free", // fast, reliable, good JSON
  "qwen/qwen2.5-vl-72b-instruct:free",             // strong scene understanding
  "qwen/qwen2.5-vl-32b-instruct:free",
  "google/gemini-2.0-flash-exp:free",              // vision-capable backup
  "mistralai/mistral-small-3.2-24b-instruct:free",
];

let lastWorkingModel = null;
function modelTryOrder() {
  if (lastWorkingModel && OPENROUTER_VISION_MODELS.includes(lastWorkingModel)) {
    return [lastWorkingModel, ...OPENROUTER_VISION_MODELS.filter(m => m !== lastWorkingModel)];
  }
  return OPENROUTER_VISION_MODELS;
}

const TAG_PROMPT =
  "You are tagging a single still frame from a video clip so an editor can " +
  "find it later by what's visually on screen. Return ONLY a valid minified " +
  "JSON object (no markdown, no commentary) with exactly these keys, each an " +
  "array of short lowercase strings:\n" +
  '  "objects"    – up to 5 physical things visible (e.g. "person","mountain","drone")\n' +
  '  "scenes"     – up to 3 environment types (e.g. "outdoor market","beach","forest")\n' +
  '  "activities" – up to 3 things happening (e.g. "walking","cooking","flying")\n' +
  '  "mood"       – up to 2 lighting/atmosphere words (e.g. "golden hour","foggy")\n' +
  '  "setting"    – up to 2 context/geographic words (e.g. "urban","rural","tropical")\n' +
  "Use empty arrays for anything you can't determine. Do not invent text that " +
  "isn't supported by the image.\n" +
  'Example: {"objects":["person","market stall"],"scenes":["outdoor market"],' +
  '"activities":["walking"],"mood":["bright"],"setting":["southeast asia"]}';

// Robustly pull the first JSON object out of a model reply (strips ```json
// fences, leading prose, trailing junk). Returns {} on failure.
function parseTags(text) {
  if (!text) return {};
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return {};
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return {};
  }
}

// Coerce whatever the model returned into our fixed 5-array shape so the UI can
// rely on it. Caps array lengths and keeps only short, non-empty strings.
function normalizeTags(raw) {
  const clean = (v, max) =>
    (Array.isArray(v) ? v : [])
      .map(x => String(x || "").trim().toLowerCase())
      .filter(x => x && x.length <= 40)
      .slice(0, max);
  return {
    objects: clean(raw.objects, 5),
    scenes: clean(raw.scenes, 3),
    activities: clean(raw.activities, 3),
    mood: clean(raw.mood, 2),
    setting: clean(raw.setting, 2),
    tagged_at: new Date().toISOString(),
  };
}

async function callOpenRouterVision(key, dataUrl, filename) {
  let lastErr = null;
  for (const model of modelTryOrder()) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://footagebrain.com",
          "X-Title": "FootageBrain Vision Tagger",
        },
        body: JSON.stringify({
          model,
          max_tokens: 400,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: TAG_PROMPT + (filename ? `\nFilename hint: ${filename}` : "") },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
        }),
      });

      if (res.status === 404 || res.status === 429 || res.status === 503) {
        const t = await res.text();
        lastErr = new Error(`OpenRouter ${res.status} for ${model}: ${t.slice(0, 160)}`);
        console.warn(lastErr.message, "— trying next free vision model");
        continue;
      }
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`OpenRouter ${res.status}: ${t.slice(0, 200)}`);
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || "";
      const parsed = parseTags(text);
      if (!Object.keys(parsed).length) {
        lastErr = new Error(`Unparseable tags from ${model}`);
        console.warn(lastErr.message, "— trying next free vision model");
        continue;
      }
      lastWorkingModel = model;
      return { tags: normalizeTags(parsed), model };
    } catch (e) {
      lastErr = e;
      console.warn(`Vision call failed for ${model}: ${e.message} — trying next free vision model`);
    }
  }
  throw lastErr || new Error("All OpenRouter free vision models failed");
}

export default async function handler(req, res) {
  const _allowedOrigins = new Set(["https://footagebrain.com", "https://www.footagebrain.com"]);
  const _origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin", _allowedOrigins.has(_origin) ? _origin : "https://footagebrain.com");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  const { thumbnail_url, filename } = req.body || {};
  if (!thumbnail_url || typeof thumbnail_url !== "string") {
    res.status(400).json({ error: "thumbnail_url is required" });
    return;
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) { res.status(500).json({ error: "OPENROUTER_API_KEY not configured on this server" }); return; }

  // Keep only the basename — the backend stores thumbnail_path with a directory
  // prefix and sometimes Windows backslashes (same logic as footageBrainThumbnailUrl).
  const name = thumbnail_url.split(/[\\/]/).pop();
  const thumbUrl = `${FB_ORIGIN}/thumbnails/${name}`;

  try {
    const imgRes = await fetch(thumbUrl);
    if (!imgRes.ok) {
      res.status(502).json({ error: `Could not fetch thumbnail (${imgRes.status})` });
      return;
    }
    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await imgRes.arrayBuffer());
    if (!buf.length) { res.status(502).json({ error: "Empty thumbnail" }); return; }
    const dataUrl = `data:${contentType};base64,${buf.toString("base64")}`;

    const { tags, model } = await callOpenRouterVision(key, dataUrl, filename);
    res.status(200).json({ tags, model });
  } catch (e) {
    console.error("tag-footage failed:", e);
    res.status(500).json({ error: e.message || String(e) });
  }
}
