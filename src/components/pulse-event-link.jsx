/* PulseEventLink — attach a World-Monitor geo event to a pipeline target:
   a reel, a review-lane card (review_card), or a location. Opened from a geo
   row's "Link" button in PulseWorld; rendered as a small panel/modal by the
   parent (src/pages/pulse.jsx).

   Behaviour (per frozen contract):
     · Pick a target TYPE (reel | review_card | location).
     · Manual pick from the store-provided list for that type.
     · A region / coordinate AUTO-MATCH SUGGESTION is offered when a target's
       name/region matches the event's region (and, for locations, when it
       carries lat/`lng` near the event). The suggestion only pre-selects the
       pick — it NEVER auto-creates a link.
     · Create → actions.createEventLink(eventId, { targetType, targetId, label }).
     · Existing links for this event are listed with an unlink (delete) button →
       actions.deleteEventLink(id).
   All mutating affordances are gated behind `isOwner`.

   Pure / controlled component (mirrors PulseSources): the parent passes the
   `event` being linked, the store lists (`reels`, `reviewLaneCards`,
   `locations`), the existing `eventLinks`, `actions`, and `isOwner`. All
   consumed store values are null-guarded.

   Component export name is FROZEN: PulseEventLink. */

import React, { useMemo, useState } from "react";

const TARGET_TYPES = [
  { k: "reel",        l: "Reel" },
  { k: "review_card", l: "Review card" },
  { k: "location",    l: "Location" },
];

/* Rough great-circle-ish proximity: events within ~1.5° of a location's
   coordinates are considered a coordinate match for the suggestion. Uses the
   frozen geo column name `lng` (NOT lon) on both the event and the location. */
const COORD_MATCH_DEG = 1.5;
function coordsNear(a, b) {
  if (typeof a?.lat !== "number" || typeof a?.lng !== "number") return false;
  if (typeof b?.lat !== "number" || typeof b?.lng !== "number") return false;
  return Math.abs(a.lat - b.lat) <= COORD_MATCH_DEG &&
         Math.abs(a.lng - b.lng) <= COORD_MATCH_DEG;
}

function norm(s) {
  return (s == null ? "" : String(s)).trim().toLowerCase();
}

/* Pull a human label off whatever target shape we were handed. Reels/cards use
   `title`; locations may use `name`/`label`/`title`. Falls back to the id. */
function targetLabel(t) {
  if (!t) return "";
  return t.title || t.name || t.label || t.id || "";
}

/* Normalize the three store lists into a single {id, label, region, lat, lng}
   option shape so the picker + auto-match treat them uniformly. */
function toOptions(items) {
  return (Array.isArray(items) ? items : []).map((t) => ({
    id: t.id,
    label: targetLabel(t),
    region: t.region ?? null,
    lat: typeof t.lat === "number" ? t.lat : null,
    lng: typeof t.lng === "number" ? t.lng : null,
  }));
}

export function PulseEventLink({
  event,
  reels,
  reviewLaneCards,
  locations,
  eventLinks,
  actions,
  isOwner,
  onClose,
}) {
  const [targetType, setTargetType] = useState("reel");
  const [targetId, setTargetId]     = useState("");
  const [label, setLabel]           = useState("");
  const [error, setError]           = useState("");
  const [busy, setBusy]             = useState(false);

  const optionsByType = useMemo(() => ({
    reel:        toOptions(reels),
    review_card: toOptions(reviewLaneCards),
    location:    toOptions(locations),
  }), [reels, reviewLaneCards, locations]);

  const options = optionsByType[targetType] || [];

  /* Links already attached to THIS event. */
  const existing = useMemo(() => {
    const all = Array.isArray(eventLinks) ? eventLinks : [];
    return all.filter((l) => l.eventId === event?.id);
  }, [eventLinks, event]);

  /* Auto-match SUGGESTION for the current target type: the first option whose
     region matches the event's region, or (for locations) whose coordinates
     are near the event. Suggestion only — caller must still confirm. */
  const suggestion = useMemo(() => {
    if (!event) return null;
    const evRegion = norm(event.region);
    const byRegion = evRegion
      ? options.find((o) => norm(o.region) && norm(o.region) === evRegion)
      : null;
    if (byRegion) return { ...byRegion, why: "region" };
    if (targetType === "location") {
      const byCoord = options.find((o) => coordsNear(event, o));
      if (byCoord) return { ...byCoord, why: "coordinates" };
    }
    return null;
  }, [event, options, targetType]);

  if (!event) return null;

  const linkedIds = new Set(
    existing.filter((l) => l.targetType === targetType).map((l) => l.targetId)
  );

  const pickType = (k) => {
    setTargetType(k);
    setTargetId("");
    if (error) setError("");
  };

  const applySuggestion = () => {
    if (!suggestion) return;
    setTargetId(suggestion.id);
    if (!label.trim()) setLabel(suggestion.label || "");
    if (error) setError("");
  };

  const create = async () => {
    if (!isOwner) return;
    const id = targetId.trim();
    if (!id) { setError("Pick a target to link."); return; }
    if (linkedIds.has(id)) { setError("That target is already linked."); return; }
    setBusy(true);
    setError("");
    try {
      await actions?.createEventLink?.(event.id, {
        targetType,
        targetId: id,
        label: label.trim() || null,
      });
      setTargetId("");
      setLabel("");
    } catch (e) {
      setError(e?.message || "Could not create link.");
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (linkId) => {
    if (!isOwner) return;
    try {
      await actions?.deleteEventLink?.(linkId);
    } catch (e) {
      setError(e?.message || "Could not remove link.");
    }
  };

  const optLabelFor = (type, id) => {
    const opt = (optionsByType[type] || []).find((o) => o.id === id);
    return opt?.label || id;
  };

  return (
    <div className="pulse-evlink">
      <div className="pulse-evlink-head">
        <span className="pulse-evlink-title">Link event</span>
        <span className="pulse-evlink-event">
          {event.title || event.place || event.metric || event.id}
        </span>
        {typeof onClose === "function" && (
          <button type="button" className="pulse-evlink-close"
                  onClick={onClose} title="Close">✕</button>
        )}
      </div>

      {/* ── Existing links ───────────────────────────────────── */}
      <div className="pulse-evlink-existing">
        <div className="pulse-evlink-subhead">
          {existing.length} link{existing.length === 1 ? "" : "s"}
        </div>
        {existing.length === 0 ? (
          <div className="pulse-evlink-empty">Not linked to anything yet.</div>
        ) : (
          existing.map((l) => (
            <div key={l.id} className="pulse-evlink-row">
              <span className="pulse-evlink-row-type">
                {(TARGET_TYPES.find((t) => t.k === l.targetType) || {}).l || l.targetType}
              </span>
              <span className="pulse-evlink-row-label">
                {l.label || optLabelFor(l.targetType, l.targetId)}
              </span>
              {isOwner && (
                <button type="button" className="pulse-evlink-unlink"
                        onClick={() => unlink(l.id)} title="Remove link">
                  Unlink
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* ── Add a link (owner only) ──────────────────────────── */}
      {isOwner && (
        <div className="pulse-evlink-add">
          <div className="pulse-evlink-types" role="group" aria-label="Target type">
            {TARGET_TYPES.map((t) => (
              <button
                key={t.k}
                type="button"
                className={"pulse-evlink-type-btn" + (targetType === t.k ? " is-on" : "")}
                aria-pressed={targetType === t.k}
                onClick={() => pickType(t.k)}
              >{t.l}</button>
            ))}
          </div>

          {suggestion && suggestion.id !== targetId && (
            <div className="pulse-evlink-suggest">
              <span className="pulse-evlink-suggest-txt">
                Suggested ({suggestion.why}): <b>{suggestion.label}</b>
              </span>
              <button type="button" className="pulse-evlink-suggest-use"
                      onClick={applySuggestion}>Use</button>
            </div>
          )}

          <label className="pulse-evlink-field">
            <span className="pulse-evlink-field-label">Target</span>
            <select
              className="pulse-evlink-select"
              value={targetId}
              onChange={(e) => { setTargetId(e.target.value); if (error) setError(""); }}
            >
              <option value="">
                {options.length ? "Select a target…" : "No targets available"}
              </option>
              {options.map((o) => (
                <option key={o.id} value={o.id} disabled={linkedIds.has(o.id)}>
                  {o.label}{linkedIds.has(o.id) ? " (linked)" : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="pulse-evlink-field">
            <span className="pulse-evlink-field-label">Label (optional)</span>
            <input
              className="pulse-evlink-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. background context for the edit"
            />
          </label>

          {error && <div className="pulse-evlink-error">{error}</div>}

          <button
            type="button"
            className="pulse-evlink-create"
            onClick={create}
            disabled={busy || !targetId.trim()}
          >
            {busy ? "Linking…" : "Link event"}
          </button>
        </div>
      )}
    </div>
  );
}

export default PulseEventLink;
