/* =========================================================
   Locations — page with two layers.

     Layer 1 · Map        the quick Google My Maps embed, usable
                          immediately, no setup.
     Layer 2 · Structured the importable Location table that other
                          tools (reels, planning, notes) link to.
                          Backed by useLocations() (see
                          ../lib/locations-data.jsx).

   Styling reuses the existing page chrome (page-head / exp-table /
   DPill) so it sits inside the shell like Export/Analytics — no
   new global CSS.
   ========================================================= */

import React, { useMemo, useRef, useState, useCallback, useEffect } from "react";
import { DPill } from "../components/components.jsx";
import { APIProvider, Map, AdvancedMarker, InfoWindow } from "@vis.gl/react-google-maps";
import { supabase } from "../lib/supabase-client.js";
import { useWorkflow } from "../store/store.jsx";
import {
  MY_MAPS,
  myMapsEmbedUrl,
  parseAny,
  geocode,
  useLocations,
} from "../lib/locations-data.jsx";

const MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";

/* ── Marker + InfoWindow for one location ──────────────── */
function LocationMarker({ location: l, selected, onSelect, onEdit }) {
  if (l.lat == null || l.lng == null) return null;
  const pos = { lat: l.lat, lng: l.lng };
  return (
    <>
      <AdvancedMarker
        position={pos}
        onClick={() => onSelect(selected ? null : l)}
        title={l.name}
      />
      {selected && (
        <InfoWindow position={pos} onCloseClick={() => onSelect(null)}>
          <div style={{ fontFamily: "sans-serif", maxWidth: 210, fontSize: 13 }}>
            <div style={{ fontWeight: 700, marginBottom: 3 }}>{l.name}</div>
            {l.category && (
              <div style={{ fontSize: 11, color: "#888", marginBottom: 2 }}>{l.category}</div>
            )}
            {l.notes && (
              <div style={{ fontSize: 12, marginTop: 4, color: "#444" }}>{l.notes}</div>
            )}
            {l.linkedReelIds?.length > 0 && (
              <div style={{ fontSize: 11, marginTop: 5, color: "#0a8" }}>
                {l.linkedReelIds.length} linked reel{l.linkedReelIds.length > 1 ? "s" : ""}
              </div>
            )}
            <div style={{ marginTop: 8 }}>
              <span
                style={{ fontSize: 11, color: "var(--c-cyan, #06b6d4)", cursor: "pointer" }}
                onClick={() => onEdit(l)}
              >
                ✎ Edit
              </span>
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  );
}

/* ── Edit panel drawer for a single location pin ─────────── */
function EditPinPanel({ location, onClose, actions, reels }) {
  const [name, setName] = useState(location.name || "");
  const [category, setCategory] = useState(location.category || "");
  const [notes, setNotes] = useState(location.notes || "");
  const [photos, setPhotos] = useState([]);
  const [photosLoading, setPhotosLoading] = useState(true);
  const [reelSearch, setReelSearch] = useState("");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setPhotosLoading(true);
    supabase.from("location_photos").select("*").eq("location_id", location.id).order("created_at")
      .then(({ data }) => { setPhotos(data || []); setPhotosLoading(false); });
  }, [location.id]);

  const saveField = (field, value) => {
    actions.update(location.id, { [field]: value });
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    for (const file of files) {
      const ext = file.name.split(".").pop();
      const path = `${location.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { data: uploadData, error } = await supabase.storage.from("location-photos").upload(path, file, { upsert: false });
      if (!error && uploadData) {
        const { data: { publicUrl } } = supabase.storage.from("location-photos").getPublicUrl(uploadData.path);
        const newPhoto = await actions.addPhoto(location.id, publicUrl, "");
        if (newPhoto) setPhotos(prev => [...prev, newPhoto]);
      }
    }
    setUploading(false);
    e.target.value = "";
  };

  const handleRemovePhoto = async (photoId) => {
    await actions.removePhoto(photoId);
    setPhotos(prev => prev.filter(p => p.id !== photoId));
  };

  const [linkedReelIds, setLinkedReelIds] = useState(location.linkedReelIds || []);
  const filteredReels = useMemo(() => {
    const q = reelSearch.trim().toLowerCase();
    return q ? reels.filter(r => (r.title || r.id || "").toLowerCase().includes(q)) : reels;
  }, [reels, reelSearch]);

  const toggleReel = (reelId) => {
    if (linkedReelIds.includes(reelId)) {
      setLinkedReelIds(prev => prev.filter(id => id !== reelId));
      actions.unlinkReel(location.id, reelId);
    } else {
      setLinkedReelIds(prev => [...prev, reelId]);
      actions.linkReel(location.id, reelId);
    }
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.4)" }}
      />
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 1001,
        width: "min(420px, 95vw)",
        background: "var(--bg, #0d1525)",
        borderLeft: "1px solid var(--line-hard)",
        overflowY: "auto",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--line-hard)" }}>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 13, color: "var(--fg)", flex: 1 }}>Edit Location</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--fg-dim)", fontSize: 16, cursor: "pointer", padding: "2px 6px" }}>✕</button>
        </div>

        <div style={{ padding: "16px", flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-dim)", textTransform: "uppercase", letterSpacing: 0.6, display: "block", marginBottom: 4 }}>Name</label>
            <input value={name} onChange={e => setName(e.target.value)} onBlur={() => saveField("name", name)}
              style={{ width: "100%", background: "var(--bg-2)", border: "1px solid var(--line-hard)", borderRadius: 4, color: "var(--fg)", fontFamily: "var(--f-mono)", fontSize: 12, padding: "6px 10px", boxSizing: "border-box" }} />
          </div>

          <div>
            <label style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-dim)", textTransform: "uppercase", letterSpacing: 0.6, display: "block", marginBottom: 4 }}>Category</label>
            <input value={category} onChange={e => setCategory(e.target.value)} onBlur={() => saveField("category", category)}
              style={{ width: "100%", background: "var(--bg-2)", border: "1px solid var(--line-hard)", borderRadius: 4, color: "var(--fg)", fontFamily: "var(--f-mono)", fontSize: 12, padding: "6px 10px", boxSizing: "border-box" }} />
          </div>

          <div>
            <label style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-dim)", textTransform: "uppercase", letterSpacing: 0.6, display: "block", marginBottom: 4 }}>Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} onBlur={() => saveField("notes", notes)}
              rows={3} style={{ width: "100%", background: "var(--bg-2)", border: "1px solid var(--line-hard)", borderRadius: 4, color: "var(--fg)", fontFamily: "var(--f-mono)", fontSize: 12, padding: "6px 10px", boxSizing: "border-box", resize: "vertical" }} />
          </div>

          <div>
            <label style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-dim)", textTransform: "uppercase", letterSpacing: 0.6, display: "block", marginBottom: 6 }}>
              Reel Cards ({linkedReelIds.length} attached)
            </label>
            <input value={reelSearch} onChange={e => setReelSearch(e.target.value)} placeholder="Search reels…"
              style={{ width: "100%", background: "var(--bg-2)", border: "1px solid var(--line-hard)", borderRadius: 4, color: "var(--fg)", fontFamily: "var(--f-mono)", fontSize: 11, padding: "5px 10px", marginBottom: 6, boxSizing: "border-box" }} />
            <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid var(--line-hard)", borderRadius: 4 }}>
              {filteredReels.slice(0, 40).map(reel => {
                const linked = linkedReelIds.includes(reel.id);
                return (
                  <div
                    key={reel.id}
                    onClick={() => toggleReel(reel.id)}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", cursor: "pointer", borderBottom: "1px solid var(--line-hard)", background: linked ? "rgba(6,182,212,0.08)" : "transparent", userSelect: "none" }}
                  >
                    <span style={{
                      width: 14, height: 14, flexShrink: 0, borderRadius: 3,
                      border: "1px solid " + (linked ? "var(--c-cyan)" : "var(--line-hard)"),
                      background: linked ? "var(--c-cyan)" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, color: "#0b1220", fontWeight: 700,
                    }}>
                      {linked ? "✓" : ""}
                    </span>
                    <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: linked ? "var(--c-cyan)" : "var(--fg)" }}>
                      {reel.display_number ? `#${reel.display_number} ` : ""}{reel.title || reel.id}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <label style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-dim)", textTransform: "uppercase", letterSpacing: 0.6, display: "block", marginBottom: 6 }}>
              Screenshots & Photos ({photos.length})
            </label>

            <label style={{ display: "block", border: "1px dashed var(--line-hard)", borderRadius: 4, padding: "12px", textAlign: "center", cursor: "pointer", marginBottom: 10, color: "var(--fg-dim)", fontFamily: "var(--f-mono)", fontSize: 11 }}>
              {uploading ? "Uploading…" : "Click or drag images to upload"}
              <input type="file" multiple accept="image/*" onChange={handleFileUpload} style={{ display: "none" }} />
            </label>

            {photosLoading ? (
              <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-dim)" }}>Loading photos…</div>
            ) : photos.length === 0 ? (
              <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-dim)" }}>No screenshots yet.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 10 }}>
                {photos.map(photo => (
                  <div key={photo.id} style={{ position: "relative", aspectRatio: "1", overflow: "hidden", borderRadius: 4, border: "1px solid var(--line-hard)" }}>
                    <img src={photo.url} alt={photo.caption || "location photo"} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    <button
                      onClick={() => handleRemovePhoto(photo.id)}
                      style={{ position: "absolute", top: 3, right: 3, background: "rgba(0,0,0,0.7)", border: "none", color: "#fff", borderRadius: 3, fontSize: 10, padding: "1px 5px", cursor: "pointer" }}
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ marginTop: "auto", paddingTop: 16, borderTop: "1px solid var(--line-hard)" }}>
            <button
              onClick={() => {
                if (confirm(`Remove "${location.name}"? This cannot be undone.`)) {
                  actions.remove(location.id);
                  onClose();
                }
              }}
              style={{ background: "none", border: "1px solid var(--c-red, #ef4444)", borderRadius: 4, color: "var(--c-red, #ef4444)", fontFamily: "var(--f-mono)", fontSize: 11, padding: "6px 14px", cursor: "pointer" }}
            >
              Delete location
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/* Same blob-download helper Export uses, kept local so the two
   pages stay independent. */
function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function ImportPanel({ onClose }) {
  const { actions } = useLocations();
  const [text, setText] = useState("");
  const [msg, setMsg] = useState(null);
  const fileRef = useRef(null);

  const runImport = src => {
    const records = parseAny(src, MY_MAPS.mid);
    if (!records.length) {
      setMsg({
        tone: "warn",
        text:
          "Couldn't read any places. Paste KML (My Maps → Export to KML/KMZ, " +
          "then open the .kml), GeoJSON, or a CSV with name,lat,lng columns.",
      });
      return;
    }
    const { added, skipped } = actions.importRecords(records);
    setMsg({
      tone: "ok",
      text:
        "Imported " +
        added +
        " place" +
        (added === 1 ? "" : "s") +
        (skipped ? " · skipped " + skipped + " already present" : "") +
        ".",
    });
    if (added) setText("");
  };

  const onFile = e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => runImport(String(reader.result || ""));
    reader.readAsText(f);
    e.target.value = "";
  };

  return (
    <div
      style={{
        border: "1px dashed var(--line-hard)",
        borderRadius: 8,
        padding: 16,
        margin: "0 22px 18px 22px",
        background: "rgba(255,255,255,0.015)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <div
          className="mono"
          style={{ fontSize: 12, color: "var(--fg)", letterSpacing: 0.3 }}
        >
          IMPORT MAP DATA
        </div>
        <span
          className="mono dim"
          style={{ cursor: "pointer" }}
          onClick={onClose}
        >
          close ✕
        </span>
      </div>
      <div
        style={{
          color: "var(--fg-mute)",
          fontSize: 12.5,
          lineHeight: 1.5,
          marginBottom: 10,
        }}
      >
        From the My Maps map: <b style={{ color: "var(--fg)" }}>⋮ → Export to
        KML/KMZ</b> (tick "Export as KML"), then paste the .kml text below or
        upload the file. GeoJSON and <span className="mono">name,lat,lng</span>{" "}
        CSV also work. Re-importing the same map is safe — duplicates are
        skipped.
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Paste KML / GeoJSON / CSV here…"
        spellCheck={false}
        style={{
          width: "100%",
          minHeight: 120,
          resize: "vertical",
          background: "var(--bg-2, rgba(0,0,0,0.25))",
          color: "var(--fg)",
          border: "1px solid var(--line-hard)",
          borderRadius: 6,
          padding: "10px 12px",
          fontFamily: "var(--f-mono)",
          fontSize: 12,
          boxSizing: "border-box",
        }}
      />
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginTop: 10,
          flexWrap: "wrap",
        }}
      >
        <DPill primary onClick={() => runImport(text)}>
          Import from text
        </DPill>
        <DPill onClick={() => fileRef.current && fileRef.current.click()}>
          Upload .kml / .geojson / .csv
        </DPill>
        <input
          ref={fileRef}
          type="file"
          accept=".kml,.geojson,.json,.csv,application/vnd.google-earth.kml+xml,text/csv"
          onChange={onFile}
          style={{ display: "none" }}
        />
        {msg && (
          <span
            className="mono"
            style={{
              fontSize: 11.5,
              color:
                msg.tone === "ok" ? "var(--c-green)" : "var(--c-amber)",
            }}
          >
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Route Planner — build a Google Maps directions link from location pins ── */
function RoutePlanner({ locations }) {
  const [stops, setStops] = useState([]); // array of location objects
  const [search, setSearch] = useState("");

  const available = useMemo(() => {
    const stopIds = new Set(stops.map(s => s.id));
    const q = search.trim().toLowerCase();
    return locations.filter(l => !stopIds.has(l.id) && (!q || (l.name || "").toLowerCase().includes(q)));
  }, [locations, stops, search]);

  const addStop = (loc) => {
    setStops(prev => [...prev, loc]);
    setSearch("");
  };

  const removeStop = (id) => setStops(prev => prev.filter(s => s.id !== id));

  const moveStop = (idx, dir) => {
    setStops(prev => {
      const arr = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= arr.length) return arr;
      [arr[idx], arr[target]] = [arr[target], arr[idx]];
      return arr;
    });
  };

  const openRoute = () => {
    if (stops.length < 2) return;
    const waypoints = stops.map(s => {
      if (s.lat != null && s.lng != null) return `${s.lat},${s.lng}`;
      return encodeURIComponent(s.name);
    });
    const origin = waypoints[0];
    const dest   = waypoints[waypoints.length - 1];
    const mids   = waypoints.slice(1, -1);
    let url = `https://www.google.com/maps/dir/${origin}/${dest}`;
    if (mids.length) url = `https://www.google.com/maps/dir/${origin}/${mids.join("/")}/${dest}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="loc-trip-panel" style={{
      marginTop: 16, border: "1px dashed var(--line-hard)", borderRadius: 8,
      padding: "14px 16px", background: "rgba(255,255,255,0.015)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span className="mono" style={{ fontSize: 11, color: "var(--fg-dim)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Route Planner
        </span>
        <span className="mono dim" style={{ fontSize: 10 }}>
          Add stops in order, then open in Google Maps
        </span>
      </div>

      {/* Stop list */}
      {stops.length > 0 && (
        <div style={{ marginBottom: 10, display: "flex", flexDirection: "column", gap: 4 }}>
          {stops.map((s, i) => (
            <div key={s.id} style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "var(--bg-2)", borderRadius: 4, padding: "5px 10px",
              border: "1px solid var(--line-hard)",
            }}>
              <span className="mono" style={{ fontSize: 10, color: "var(--c-cyan)", minWidth: 18 }}>{i + 1}</span>
              <span style={{ flex: 1, fontSize: 12, fontFamily: "var(--f-mono)", color: "var(--fg)" }}>{s.name}</span>
              {s.lat == null && (
                <span className="mono" style={{ fontSize: 9, color: "var(--c-amber)" }}>no coords</span>
              )}
              <button onClick={() => moveStop(i, -1)} disabled={i === 0}
                style={{ background: "none", border: "none", color: "var(--fg-dim)", cursor: i === 0 ? "default" : "pointer", fontSize: 12, padding: "0 3px", opacity: i === 0 ? 0.3 : 1 }}>▲</button>
              <button onClick={() => moveStop(i, 1)} disabled={i === stops.length - 1}
                style={{ background: "none", border: "none", color: "var(--fg-dim)", cursor: i === stops.length - 1 ? "default" : "pointer", fontSize: 12, padding: "0 3px", opacity: i === stops.length - 1 ? 0.3 : 1 }}>▼</button>
              <button onClick={() => removeStop(s.id)}
                style={{ background: "none", border: "none", color: "var(--fg-dim)", cursor: "pointer", fontSize: 13, padding: "0 3px" }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {stops.length === 0 && (
        <div className="mono dim" style={{ fontSize: 11, marginBottom: 10 }}>
          No stops yet — search and add locations below.
        </div>
      )}

      {/* Search to add */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search locations to add as a stop…"
          style={{
            flex: 1, minWidth: 180, background: "var(--bg-2)", border: "1px solid var(--line-hard)",
            borderRadius: 4, color: "var(--fg)", fontFamily: "var(--f-mono)", fontSize: 11,
            padding: "6px 10px",
          }}
        />
        <button
          onClick={openRoute}
          disabled={stops.length < 2}
          style={{
            padding: "6px 14px", fontSize: 11, fontFamily: "var(--f-mono)",
            background: stops.length >= 2 ? "var(--c-cyan)" : "var(--bg-2)",
            color: stops.length >= 2 ? "#0b1220" : "var(--fg-dim)",
            border: "none", borderRadius: 4, cursor: stops.length >= 2 ? "pointer" : "default",
            fontWeight: 600, whiteSpace: "nowrap",
          }}
        >
          Open in Google Maps →
        </button>
        {stops.length > 0 && (
          <button onClick={() => setStops([])}
            style={{ background: "none", border: "1px solid var(--line-hard)", color: "var(--fg-dim)", borderRadius: 4, fontSize: 10, fontFamily: "var(--f-mono)", padding: "5px 10px", cursor: "pointer" }}>
            Clear
          </button>
        )}
      </div>

      {search.trim() && available.length > 0 && (
        <div style={{
          marginTop: 6, border: "1px solid var(--line-hard)", borderRadius: 4,
          background: "var(--bg-1)", maxHeight: 160, overflowY: "auto",
        }}>
          {available.slice(0, 20).map(loc => (
            <div key={loc.id}
              onClick={() => addStop(loc)}
              style={{
                padding: "7px 12px", cursor: "pointer", fontSize: 12,
                fontFamily: "var(--f-mono)", color: "var(--fg)",
                borderBottom: "1px solid var(--line-hard)",
                display: "flex", alignItems: "center", gap: 8,
              }}
              onMouseEnter={e => e.currentTarget.style.background = "var(--bg-2)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <span style={{ flex: 1 }}>{loc.name}</span>
              {loc.lat != null && (
                <span className="mono" style={{ fontSize: 9, color: "var(--c-cyan)" }}>
                  {Number(loc.lat).toFixed(3)},{Number(loc.lng).toFixed(3)}
                </span>
              )}
              <span style={{ fontSize: 11, color: "var(--c-cyan)" }}>+ add</span>
            </div>
          ))}
        </div>
      )}
      {search.trim() && available.length === 0 && (
        <div className="mono dim" style={{ fontSize: 11, marginTop: 6 }}>No matching locations.</div>
      )}
    </div>
  );
}

function Locations() {
  const { locations, loaded, actions } = useLocations();
  const { reels } = useWorkflow();
  const [tab, setTab] = useState("mymaps");
  const [showImport, setShowImport] = useState(false);
  const [selectedMarker, setSelectedMarker] = useState(null);
  const [geocoding, setGeocoding] = useState({});
  const [editingPin, setEditingPin] = useState(null);

  const handleGeocode = useCallback(async (l) => {
    const addr = l.address || l.notes;
    if (!addr || geocoding[l.id]) return;
    setGeocoding(g => ({ ...g, [l.id]: true }));
    const pt = await geocode(addr);
    setGeocoding(g => { const n = { ...g }; delete n[l.id]; return n; });
    if (pt) actions.update(l.id, { lat: pt.lat, lng: pt.lng });
  }, [geocoding, actions]);

  const handleGeocodeAll = useCallback(async () => {
    const missing = locations.filter(l => l.lat == null && (l.address || l.notes));
    for (const l of missing) {
      await handleGeocode(l);
    }
  }, [locations, handleGeocode]);

  const sorted = useMemo(
    () =>
      [...locations].sort((a, b) =>
        (a.name || "").localeCompare(b.name || "")
      ),
    [locations]
  );

  const withCoords = sorted.filter(l => l.lat != null && l.lng != null).length;

  const addManual = () => {
    const name = prompt("Place name");
    if (!name) return;
    actions.add({ name, source: "manual", mapMid: MY_MAPS.mid });
    setTab("data");
  };

  const exportJson = () => {
    if (!locations.length) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(
      actions.exportJson(),
      "ziflow-locations-" + stamp + ".json",
      "application/json"
    );
  };

  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1>Locations</h1>
          <div className="sub">
            Quick Google My&nbsp;Maps view, plus a structured place list you
            can import into and later link to reels, planning, and notes.
          </div>
        </div>
        <div className="actions">
          <DPill active={tab === "mymaps"} onClick={() => setTab("mymaps")}>
            My Maps
          </DPill>
          <DPill active={tab === "interactive"} onClick={() => setTab("interactive")}>
            Interactive
          </DPill>
          <DPill active={tab === "data"} onClick={() => setTab("data")}>
            Structured ({locations.length})
          </DPill>
        </div>
      </div>

      {tab === "mymaps" && (
        <div style={{ padding: "0 22px 22px 22px" }}>
          <div
            style={{
              border: "1px solid var(--line-hard)",
              borderRadius: 8,
              overflow: "hidden",
              background: "#000",
            }}
          >
            <iframe
              title={MY_MAPS.label}
              src={myMapsEmbedUrl()}
              loading="lazy"
              style={{
                width: "100%",
                height: "calc(100vh - 240px)",
                minHeight: 420,
                border: 0,
                display: "block",
              }}
            />
          </div>
          <div className="mono dim" style={{ fontSize: 11, marginTop: 8 }}>
            Live embed of the shared Google My&nbsp;Maps map · edits made in
            My&nbsp;Maps appear here automatically.
          </div>
          <RoutePlanner locations={sorted} />
        </div>
      )}

      {tab === "interactive" && (
        <div style={{ padding: "0 22px 22px 22px" }}>
          {MAPS_API_KEY ? (
            <div style={{ position: "relative", border: "1px solid var(--line-hard)", borderRadius: 8, overflow: "hidden", background: "#000" }}>
              <APIProvider apiKey={MAPS_API_KEY}>
                <Map
                  defaultCenter={{ lat: 39.5, lng: -98.35 }}
                  defaultZoom={4}
                  mapId="ziflow-locations"
                  gestureHandling="greedy"
                  style={{ width: "100%", height: "calc(100vh - 240px)", minHeight: 420 }}
                >
                  {sorted.filter(l => l.lat != null && l.lng != null).map(l => (
                    <LocationMarker
                      key={l.id}
                      location={l}
                      selected={selectedMarker === l.id}
                      onSelect={loc => setSelectedMarker(loc ? loc.id : null)}
                      onEdit={setEditingPin}
                    />
                  ))}
                </Map>
              </APIProvider>
            </div>
          ) : (
            <div style={{
              border: "1px dashed var(--line-hard)", borderRadius: 8,
              padding: "48px 24px", textAlign: "center",
              color: "var(--fg-dim)", fontFamily: "var(--f-mono)", fontSize: 12,
            }}>
              Interactive map requires a <code>VITE_GOOGLE_MAPS_API_KEY</code> environment variable.
              <br />
              <span style={{ fontSize: 10, color: "var(--fg-faint)", marginTop: 6, display: "block" }}>
                Use the <strong>My Maps</strong> tab to view and edit your map.
              </span>
            </div>
          )}
          <div className="mono dim" style={{ fontSize: 11, marginTop: 8 }}>
            Click a pin to view details or edit. Use{" "}
            <b style={{ color: "var(--fg-mute)" }}>Structured</b> to manage the place list.
          </div>
        </div>
      )}

      {tab === "data" && (
        <div>
          <div
            style={{
              display: "flex",
              gap: 8,
              padding: "0 22px 14px 22px",
              flexWrap: "wrap",
            }}
          >
            <DPill primary onClick={() => setShowImport(s => !s)}>
              {showImport ? "Hide import" : "Import map data"}
            </DPill>
            <DPill onClick={addManual}>+ Add place</DPill>
            <DPill
              onClick={exportJson}
              style={{
                opacity: locations.length ? 1 : 0.5,
                cursor: locations.length ? "pointer" : "not-allowed",
              }}
            >
              Export JSON ({locations.length})
            </DPill>
            {locations.length > 0 && (
              <DPill
                tone="red"
                onClick={() => {
                  if (
                    confirm(
                      "Remove all " +
                        locations.length +
                        " locations? This only clears the local list — the My Maps map is untouched."
                    )
                  )
                    actions.clearAll();
                }}
              >
                Clear all
              </DPill>
            )}
          </div>

          {showImport && <ImportPanel onClose={() => setShowImport(false)} />}

          <div className="exp-scroll" style={{ margin: "0 22px" }}>
            <table className="exp-table">
              <thead>
                <tr>
                  <th style={{ width: 220 }}>Name</th>
                  <th style={{ width: 130 }}>Category</th>
                  <th style={{ width: 170 }}>Coordinates</th>
                  <th>Notes / address</th>
                  <th style={{ width: 90 }}>Source</th>
                  <th style={{ width: 70 }}>Reels</th>
                  <th style={{ width: 60 }} />
                </tr>
              </thead>
              <tbody>
                {loaded && sorted.length === 0 && (
                  <tr>
                    <td
                      colSpan="7"
                      style={{
                        padding: "32px 18px",
                        color: "var(--fg-dim)",
                        fontFamily: "var(--f-mono)",
                        fontSize: 12,
                      }}
                    >
                      No structured places yet. Open the My&nbsp;Maps map,
                      Export to KML, then click{" "}
                      <b style={{ color: "var(--fg-mute)" }}>Import map data</b>{" "}
                      above — or{" "}
                      <b style={{ color: "var(--fg-mute)" }}>+ Add place</b> one
                      by hand.
                    </td>
                  </tr>
                )}
                {sorted.map(l => (
                  <tr key={l.id} className="exp-row">
                    <td
                      className="serif-i"
                      style={{ color: "#eef3fb", cursor: "text" }}
                      title="Click to rename"
                      onClick={() => {
                        const v = prompt("Place name", l.name);
                        if (v != null) actions.update(l.id, { name: v });
                      }}
                    >
                      {l.name}
                    </td>
                    <td style={{ color: "var(--fg-mute)" }}>
                      {l.category || <span className="dim">—</span>}
                    </td>
                    <td className="mono">
                      {l.lat != null && l.lng != null ? (
                        <span style={{ color: "var(--c-cyan)" }}>
                          {Number(l.lat).toFixed(5)},{" "}
                          {Number(l.lng).toFixed(5)}
                        </span>
                      ) : (
                        <span className="dim">— no point —</span>
                      )}
                    </td>
                    <td
                      style={{
                        whiteSpace: "pre-wrap",
                        color: "var(--fg-mute)",
                        cursor: "text",
                      }}
                      title="Click to edit notes"
                      onClick={() => {
                        const v = prompt(
                          "Notes for " + l.name,
                          l.notes || ""
                        );
                        if (v != null) actions.update(l.id, { notes: v });
                      }}
                    >
                      {l.notes || l.address || (
                        <span className="dim">— click to add —</span>
                      )}
                    </td>
                    <td className="mono dim" style={{ fontSize: 10.5 }}>
                      {l.source}
                    </td>
                    <td className="mono">
                      {l.linkedReelIds && l.linkedReelIds.length ? (
                        <span style={{ color: "var(--c-cyan)" }}>
                          {l.linkedReelIds.length}
                        </span>
                      ) : (
                        <span className="dim">0</span>
                      )}
                    </td>
                    <td>
                      <span
                        className="mono dim"
                        style={{ cursor: "pointer", marginRight: 8 }}
                        title="Edit this location"
                        onClick={() => setEditingPin(l)}
                      >
                        ✎
                      </span>
                      <span
                        className="mono dim"
                        style={{ cursor: "pointer" }}
                        title="Remove from list"
                        onClick={() => {
                          if (confirm("Remove “" + l.name + "” from the list?"))
                            actions.remove(l.id);
                        }}
                      >
                        ✕
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div
            className="mono dim"
            style={{ fontSize: 11, padding: "10px 22px 24px 22px" }}
          >
            {withCoords} of {locations.length} have map points · the{" "}
            <span className="mono">linkedReelIds</span> /{" "}
            <span className="mono">linkedNoteIds</span> fields are the
            connection points reels, planning, and notes will read from.
          </div>
        </div>
      )}

      {editingPin && (
        <EditPinPanel
          location={editingPin}
          onClose={() => setEditingPin(null)}
          actions={actions}
          reels={reels || []}
        />
      )}
    </div>
  );
}

export { Locations };
