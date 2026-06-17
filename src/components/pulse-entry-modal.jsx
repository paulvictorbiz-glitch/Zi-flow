/* PulseEntryModal — manual entry form for a MonitorEvent.
   Mirrors TaskModal's shape; reuses Modal/Field/SegRow/SelectInput primitives.
   Controlled by parent (src/pages/pulse.jsx) via `open`, `onClose`, `onSubmit`. */

import React, { useState } from "react";
import { Modal, Field, SegRow, SelectInput } from "./modals/Modal.jsx";

const CATEGORY_OPTS = [
  { k: "algo", l: "Algorithm" },
  { k: "news", l: "World/Political" },
];

// SegRow can't emit `null` (it stringifies keys), so we use a sentinel for "none".
const PLATFORM_OPTS = [
  { k: "ig",       l: "IG" },
  { k: "youtube",  l: "YouTube" },
  { k: "tiktok",   l: "TikTok" },
  { k: "facebook", l: "Facebook" },
  { k: "x",        l: "X" },
  { k: "__none__", l: "None" },
];

const SEVERITY_OPTS = [
  { k: "info",  l: "Info" },
  { k: "watch", l: "Watch" },
  { k: "high",  l: "High" },
];

function parseTags(raw) {
  if (!raw) return [];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 5);
}

export function PulseEntryModal({ open, onClose, onSubmit, person }) {
  const [title, setTitle]           = useState("");
  const [summary, setSummary]       = useState("");
  const [category, setCategory]     = useState("news");
  const [platformKey, setPlatformKey] = useState("__none__");
  const [severity, setSeverity]     = useState("info");
  const [sourceName, setSourceName] = useState("");
  const [sourceUrl, setSourceUrl]   = useState("");
  const [region, setRegion]         = useState("");
  const [tagsRaw, setTagsRaw]       = useState("");
  const [error, setError]           = useState("");

  // Short-circuit AFTER hook declarations so we don't violate Rules of Hooks.
  if (!open) return null;

  const submit = () => {
    const t = title.trim();
    if (!t) {
      setError("Title is required.");
      return;
    }
    const platform = platformKey === "__none__" ? null : platformKey;
    const payload = {
      sourceType:  "manual",
      status:      "new",
      starred:     false,
      category,
      severity,
      platform,
      title:       t,
      summary:     summary.trim(),
      sourceName:  sourceName.trim(),
      sourceUrl:   sourceUrl.trim(),
      region:      region.trim(),
      tags:        parseTags(tagsRaw),
      publishedAt: new Date().toISOString(),
      createdBy:   person?.id || null,
    };
    onSubmit && onSubmit(payload);
    onClose && onClose();
  };

  return (
    <div className="pulse-modal">
      <Modal
        title="Log a pulse entry"
        subtitle="Manual entry — appears in the Pulse Monitor feed."
        onClose={onClose}
        onSubmit={submit}
        submitLabel="Add entry"
      >
        <Field label="Title">
          <input
            className="m-input"
            value={title}
            onChange={(e) => { setTitle(e.target.value); if (error) setError(""); }}
            placeholder="Headline (required)"
            autoFocus
          />
          {error && <div className="m-hint" style={{ color: "var(--c-red, #ef4444)" }}>{error}</div>}
        </Field>

        <Field label="Summary">
          <textarea
            className="m-textarea"
            rows="3"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="What changed / what happened. Keep it terse."
          />
        </Field>

        <Field label="Category">
          <SegRow value={category} onChange={setCategory} options={CATEGORY_OPTS} />
        </Field>

        <Field label="Platform">
          <SegRow value={platformKey} onChange={setPlatformKey} options={PLATFORM_OPTS} />
        </Field>

        <Field label="Severity">
          <SegRow value={severity} onChange={setSeverity} options={SEVERITY_OPTS} />
        </Field>

        <div className="modal-grid-2">
          <Field label="Source name">
            <input
              className="m-input"
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              placeholder="e.g. TechCrunch, Meta Newsroom"
            />
          </Field>
          <Field label="Source URL">
            <input
              className="m-input"
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://…"
            />
          </Field>
        </div>

        <Field label="Region">
          <input
            className="m-input"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder="e.g. US, EU, Global"
          />
        </Field>

        <Field label="Tags" hint="comma-separated, up to 5">
          <input
            className="m-input"
            value={tagsRaw}
            onChange={(e) => setTagsRaw(e.target.value)}
            placeholder="reels, monetization, policy"
          />
        </Field>
      </Modal>
    </div>
  );
}
