/* =========================================================
   blueprint-pdf.js — client-side, zero-dependency PDF export
   for the Content-Forge Editor Blueprint (REEL-360/REEL-377
   gold-standard shape).

   CONTRACT 4 (frozen): renderBlueprintPdf(blueprintJson, voMarkdown) -> void
     · Browser-only print-to-PDF: opens a new window, writes a
       self-contained styled HTML doc built from the SAME section
       model as the detail.jsx panel + the VO markdown, calls print().
     · MUST be invoked from a user gesture (popup-blocker safe; inline
       fallback note if window.open returns null).
     · Returns void — NOT a Blob / object-URL / data-URI.

   blueprint_json is treated as OPAQUE per the frozen schema (CONTRACT 3):
     fact_sheet[{label,value}], claim_framings{bold,bulletproof,note?},
     variations[3]{name,angle,best_for,beats[{time,visual,vo,on_screen,clip_id?}]},
     hook_bank[6], captions[], hashtags[], posting_checklist[],
     footage_refs[{clip_id,drive_url}], + optional top-level strings
     topic/logline/format_assumed/verified_facts_intro.

   The section-model helpers (footageIndexFrom / resolveClipHref) are
   exported so the React panel in detail.jsx resolves beat.clip_id the
   exact same way — one source of truth, no drift between screen + PDF.
   ========================================================= */

/* ---- shared section-model helpers (also imported by detail.jsx) ---- */

/* Build a { [clip_id]: drive_url } index from footage_refs, tolerant of a
   missing / malformed array. */
export function footageIndexFrom(blueprintJson) {
  const refs = Array.isArray(blueprintJson?.footage_refs)
    ? blueprintJson.footage_refs
    : [];
  const idx = {};
  for (const r of refs) {
    if (r && r.clip_id != null) idx[String(r.clip_id)] = r.drive_url || null;
  }
  return idx;
}

/* Resolve a beat's clip_id to a Drive URL via the footage index, or null when
   the clip has no link (caller degrades to a [clip:id] token). */
export function resolveClipHref(clipId, footageIndex) {
  if (clipId == null) return null;
  const href = footageIndex ? footageIndex[String(clipId)] : null;
  return href || null;
}

/* HTML-escape untrusted strings before they go into the print document. */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* Minimal, safe markdown → HTML for the voiceover block. Escapes first, then
   re-introduces a small, known-safe subset: #/##/### headings, **bold**,
   `code`, - / * bullet lists, and blank-line-separated paragraphs. Anything
   fancier just renders as escaped text — never raw HTML. */
function voMarkdownToHtml(md) {
  const src = String(md || "").replace(/\r\n/g, "\n");
  if (!src.trim()) return "";
  const lines = src.split("\n");
  const out = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };

  const inline = (t) =>
    esc(t)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { closeList(); continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      const lvl = h[1].length + 2; // h3..h5
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      continue;
    }
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (li) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("\n");
}

/* Build the self-contained HTML document body from the blueprint section model
   + the VO markdown. Shared conceptual model with the detail.jsx panel. */
function buildBlueprintHtml(bp, voMarkdown) {
  const b = bp || {};
  const footageIndex = footageIndexFrom(b);

  const factSheet = Array.isArray(b.fact_sheet) ? b.fact_sheet : [];
  const framings = b.claim_framings || {};
  const variations = Array.isArray(b.variations) ? b.variations : [];
  const hookBank = Array.isArray(b.hook_bank) ? b.hook_bank : [];
  const captions = Array.isArray(b.captions) ? b.captions : [];
  const hashtags = Array.isArray(b.hashtags) ? b.hashtags : [];
  const checklist = Array.isArray(b.posting_checklist) ? b.posting_checklist : [];

  const title = b.topic || b.logline || "Editor Blueprint";
  const sections = [];

  // Header / meta
  sections.push(`<header class="bp-header">
    <div class="bp-kicker">Content Forge · Editor Blueprint</div>
    <h1>${esc(title)}</h1>
    ${b.logline && b.logline !== title ? `<p class="bp-logline">${esc(b.logline)}</p>` : ""}
    ${b.format_assumed ? `<p class="bp-meta"><strong>Format:</strong> ${esc(b.format_assumed)}</p>` : ""}
    ${b.verified_facts_intro ? `<p class="bp-intro">${esc(b.verified_facts_intro)}</p>` : ""}
  </header>`);

  // Fact sheet
  if (factSheet.length) {
    const rows = factSheet
      .map((f) => `<tr><th>${esc(f?.label)}</th><td>${esc(f?.value)}</td></tr>`)
      .join("");
    sections.push(`<section><h2>Fact sheet</h2><table class="bp-facts">${rows}</table></section>`);
  }

  // Claim framings
  if (framings.bold || framings.bulletproof) {
    sections.push(`<section><h2>Claim framing</h2>
      ${framings.bold ? `<div class="bp-framing"><span class="bp-tag bp-tag-bold">Bold</span><p>${esc(framings.bold)}</p></div>` : ""}
      ${framings.bulletproof ? `<div class="bp-framing"><span class="bp-tag bp-tag-safe">Bulletproof</span><p>${esc(framings.bulletproof)}</p></div>` : ""}
      ${framings.note ? `<p class="bp-note">${esc(framings.note)}</p>` : ""}
    </section>`);
  }

  // Variations (the 3 named time-coded cutdowns)
  if (variations.length) {
    const varBlocks = variations.map((v, vi) => {
      const beats = Array.isArray(v?.beats) ? v.beats : [];
      const beatRows = beats
        .map((beat) => {
          const href = resolveClipHref(beat?.clip_id, footageIndex);
          let clipCell = "";
          if (beat?.clip_id != null && String(beat.clip_id).trim() !== "") {
            clipCell = href
              ? `<a href="${esc(href)}">Drive ↗</a>`
              : `<span class="bp-cliptoken">[clip:${esc(beat.clip_id)}]</span>`;
          }
          return `<tr>
            <td class="bp-time">${esc(beat?.time)}</td>
            <td>${esc(beat?.visual)}</td>
            <td>${beat?.vo ? esc(beat.vo) : '<span class="bp-dim">—</span>'}</td>
            <td>${beat?.on_screen ? esc(beat.on_screen) : '<span class="bp-dim">—</span>'}</td>
            <td class="bp-clip">${clipCell}</td>
          </tr>`;
        })
        .join("");
      return `<div class="bp-variation">
        <h3>${esc(v?.name || `Variation ${vi + 1}`)}</h3>
        ${v?.angle ? `<p class="bp-angle"><strong>Angle:</strong> ${esc(v.angle)}</p>` : ""}
        ${v?.best_for ? `<p class="bp-bestfor"><strong>Best for:</strong> ${esc(v.best_for)}</p>` : ""}
        ${beatRows
          ? `<table class="bp-beats">
              <thead><tr><th>Time</th><th>Visual</th><th>VO</th><th>On-screen</th><th>Clip</th></tr></thead>
              <tbody>${beatRows}</tbody>
            </table>`
          : ""}
      </div>`;
    }).join("");
    sections.push(`<section><h2>Variations</h2>${varBlocks}</section>`);
  }

  // Hook bank
  if (hookBank.length) {
    sections.push(`<section><h2>Hook bank</h2><ol class="bp-list">${hookBank.map((h) => `<li>${esc(h)}</li>`).join("")}</ol></section>`);
  }

  // Captions
  if (captions.length) {
    sections.push(`<section><h2>Captions</h2><ul class="bp-list">${captions.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></section>`);
  }

  // Hashtags
  if (hashtags.length) {
    sections.push(`<section><h2>Hashtags</h2><p class="bp-hashtags">${hashtags.map((h) => esc(h)).join(" ")}</p></section>`);
  }

  // Posting checklist
  if (checklist.length) {
    sections.push(`<section><h2>Posting checklist</h2><ul class="bp-check">${checklist.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></section>`);
  }

  // Voiceover (human-readable markdown sheet)
  const voHtml = voMarkdownToHtml(voMarkdown);
  if (voHtml) {
    sections.push(`<section class="bp-vo"><h2>Voiceover</h2><div class="bp-vo-body">${voHtml}</div></section>`);
  }

  return { docTitle: title, body: sections.join("\n") };
}

const PRINT_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #16181d; line-height: 1.5; font-size: 13px;
    padding: 32px 40px; max-width: 900px; margin: 0 auto;
  }
  a { color: #0b6ea8; text-decoration: none; }
  .bp-kicker { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: #6b7280; font-weight: 700; }
  h1 { font-size: 24px; margin: 6px 0 4px; }
  h2 { font-size: 15px; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #16181d; text-transform: uppercase; letter-spacing: .04em; }
  h3 { font-size: 14px; margin: 14px 0 6px; }
  .bp-logline { font-size: 14px; color: #374151; margin: 4px 0; }
  .bp-meta, .bp-intro { font-size: 12px; color: #4b5563; margin: 4px 0; }
  section { margin-bottom: 10px; page-break-inside: avoid; }
  table { width: 100%; border-collapse: collapse; margin: 4px 0 10px; }
  th, td { text-align: left; vertical-align: top; padding: 6px 8px; border: 1px solid #d1d5db; font-size: 12px; }
  .bp-facts th { width: 34%; background: #f3f4f6; font-weight: 700; }
  .bp-beats thead th { background: #16181d; color: #fff; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
  .bp-beats .bp-time { white-space: nowrap; font-variant-numeric: tabular-nums; font-weight: 600; }
  .bp-clip { white-space: nowrap; }
  .bp-cliptoken { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; color: #6b7280; }
  .bp-dim { color: #9ca3af; }
  .bp-framing { display: flex; gap: 8px; align-items: baseline; margin: 4px 0; }
  .bp-framing p { margin: 0; }
  .bp-tag { display: inline-block; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; padding: 2px 7px; border-radius: 999px; white-space: nowrap; }
  .bp-tag-bold { background: #fde68a; color: #92400e; }
  .bp-tag-safe { background: #bbf7d0; color: #065f46; }
  .bp-note { font-size: 12px; color: #6b7280; font-style: italic; }
  .bp-variation { margin-bottom: 14px; page-break-inside: avoid; }
  .bp-angle, .bp-bestfor { font-size: 12px; margin: 2px 0; color: #374151; }
  .bp-list, .bp-check { margin: 4px 0 10px; padding-left: 22px; }
  .bp-list li, .bp-check li { margin: 3px 0; font-size: 12.5px; }
  .bp-hashtags { font-size: 12.5px; color: #0b6ea8; word-spacing: 4px; }
  .bp-vo-body p { margin: 6px 0; }
  .bp-vo-body h3, .bp-vo-body h4, .bp-vo-body h5 { margin: 10px 0 4px; }
  .bp-vo-body code { font-family: ui-monospace, Menlo, Consolas, monospace; background: #f3f4f6; padding: 1px 4px; border-radius: 3px; }
  @media print { body { padding: 0; } a { color: #16181d; } }
`;

/* FROZEN CONTRACT 4: renderBlueprintPdf(blueprintJson, voMarkdown) -> void.
   Opens a print window, writes a self-contained doc, calls print(). Returns
   nothing. MUST be called from a user gesture. */
export function renderBlueprintPdf(blueprintJson, voMarkdown) {
  const { docTitle, body } = buildBlueprintHtml(blueprintJson, voMarkdown);

  const win = typeof window !== "undefined"
    ? window.open("", "_blank", "noopener,noreferrer,width=900,height=1200")
    : null;

  // Popup blocked (window.open returned null): degrade gracefully with an
  // inline notice instead of throwing. Still returns void per the contract.
  if (!win || !win.document) {
    if (typeof window !== "undefined") {
      // eslint-disable-next-line no-alert
      window.alert(
        "Couldn't open the print window — please allow pop-ups for this site, then click Download Blueprint PDF again."
      );
    }
    return;
  }

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(docTitle)} — Blueprint</title>
<style>${PRINT_CSS}</style>
</head>
<body>
${body}
<script>
  window.addEventListener("load", function () {
    setTimeout(function () { try { window.focus(); window.print(); } catch (e) {} }, 120);
  });
</script>
</body>
</html>`;

  win.document.open();
  win.document.write(html);
  win.document.close();
}
