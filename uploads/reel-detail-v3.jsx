// Reel Detail v3 — Cockpit / Mission-control (wild-card)
// Big NEXT ACTION block dominates. Telemetry tiles around. Activity feed below.
// Less Notion, more flight deck.

const ReelDetailV3 = () => (
  <div className="wf">
    <WFTopbar crumb="Pipeline / REEL-201 · cockpit" />
    <div className="wf-body">
      <WFNav active="main-edits" />
      <div className="wf-main">

        {/* HUD top strip */}
        <div style={{
          padding:"10px 22px",
          borderBottom:"1px dashed var(--wf-line)",
          display:"grid",
          gridTemplateColumns:"1.2fr 1fr 1fr 1fr 1fr 1fr",
          gap: 14, alignItems:"center"
        }}>
          <div>
            <div style={{ display:"flex", gap:6, alignItems:"center" }}>
              <span style={{fontFamily:"var(--wf-font-mono)", fontSize:10, letterSpacing:"0.14em", color:"var(--wf-text-3)"}}>REEL-201 · v3</span>
              <T kind="warn">flight: in-edit</T>
            </div>
            <div style={{ fontFamily:"var(--wf-font-hand)", fontSize:18, color:"var(--wf-text)", lineHeight:1.15 }}>Temple crowd sequence</div>
          </div>
          {[
            { lab:"STAGE",       v:"MAIN EDIT",     sub:"3 of 7", color:"var(--wf-warn)" },
            { lab:"OWNER",       v:"Alex Rivera",   sub:"skilled editor" },
            { lab:"TIME TO DUE", v:"06:20:14",      sub:"−1h buffer", color:"var(--wf-warn)" },
            { lab:"BLOCKERS",    v:"1",             sub:"hook A/B", color:"var(--wf-bad)" },
            { lab:"DOWNSTREAM",  v:"IDLE",          sub:"Sam · 3h slack", color:"var(--wf-bad)" },
          ].map((t, i) => (
            <div key={i} style={{ borderLeft:"1px dashed var(--wf-line)", paddingLeft:14 }}>
              <div style={{fontFamily:"var(--wf-font-mono)", fontSize:9.5, letterSpacing:"0.14em", color:"var(--wf-text-3)"}}>{t.lab}</div>
              <div style={{ fontFamily:"var(--wf-font-mono)", fontSize:17, color: t.color || "var(--wf-text)", letterSpacing:"-0.01em" }}>{t.v}</div>
              <div style={{fontFamily:"var(--wf-font-mono)", fontSize:10, color:"var(--wf-text-3)"}}>{t.sub}</div>
            </div>
          ))}
        </div>

        {/* main grid */}
        <div style={{
          flex:1, minHeight:0, overflow:"hidden",
          display:"grid",
          gridTemplateColumns:"1fr 1.4fr 1fr",
          gridTemplateRows:"1fr",
        }}>

          {/* LEFT: footage spine + dependencies */}
          <div style={{
            borderRight:"1px dashed var(--wf-line)",
            padding:"14px", overflow:"hidden",
            display:"flex", flexDirection:"column", gap:12
          }}>
            <div className="box">
              <div className="h-row">
                <span className="lbl">↑ UPSTREAM · sources</span>
                <Pill>8 selects</Pill>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                {[
                  "DJI 0214 · 00:42→00:50",
                  "DJI 0218 · 01:12→01:18",
                  "A7iv 0331 · bell ringer face",
                  "A7iv 0334 · prayer flags wipe",
                  "12 Labs · \"prayer + crowd\"",
                ].map((s, i) => (
                  <div key={i} style={{
                    display:"flex", alignItems:"center", gap:8,
                    padding:"5px 7px",
                    border:"1px dashed var(--wf-line)",
                    borderRadius:3,
                    fontFamily:"var(--wf-font-mono)", fontSize:10.5,
                    color:"var(--wf-text-2)"
                  }}>
                    <span style={{color:"var(--wf-text-3)"}}>{String(i+1).padStart(2,"0")}</span>
                    {s}
                  </div>
                ))}
              </div>
            </div>

            <div className="box" style={{ borderColor:"var(--wf-bad)" }}>
              <div className="h-row">
                <span className="lbl" style={{color:"var(--wf-bad)"}}>⚠ DEPENDENCIES BLOCKING</span>
                <T kind="bad">1</T>
              </div>
              <div style={{ fontSize:12.5, color:"var(--wf-text)", marginBottom:6 }}>
                Owner decision on opening line
              </div>
              <div style={{ fontFamily:"var(--wf-font-mono)", fontSize:11, color:"var(--wf-text-3)" }}>
                waiting 3h 12m · SLA 4h · breaches at 14:00
              </div>
              <div className="hr"></div>
              <div className="lbl" style={{ marginBottom:4 }}>OTHER DEPS</div>
              <div style={{ display:"flex", flexDirection:"column", gap:4, fontSize:11.5, color:"var(--wf-text-2)" }}>
                <span>· Music choice (A/B) — locked ✓</span>
                <span>· Approval on subtitle style — pending ⌁</span>
                <span>· Hero shot export from selects — done ✓</span>
              </div>
            </div>

            <div className="box">
              <div className="h-row"><span className="lbl">↓ DOWNSTREAM IMPACT</span></div>
              <div style={{ fontSize:12, color:"var(--wf-text-2)", lineHeight:1.45 }}>
                Variant editor (Sam) idle in <span style={{color:"var(--wf-warn)"}}>3h 20m</span>.
                Ready-to-post pipeline drops below 5 if this slips.
              </div>
            </div>
          </div>

          {/* CENTER: the cockpit — NEXT ACTION dominates */}
          <div style={{
            padding:"14px 18px",
            overflow:"hidden",
            display:"flex", flexDirection:"column", gap:14
          }}>
            {/* the big "what now" */}
            <div style={{
              border:"2px solid var(--wf-warn)",
              borderRadius:8,
              padding:"18px 22px",
              background:"rgba(241,193,74,0.05)",
              position:"relative"
            }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:8 }}>
                <span style={{fontFamily:"var(--wf-font-mono)", fontSize:10, color:"var(--wf-warn)", letterSpacing:"0.16em"}}>▶ NEXT REQUIRED ACTION</span>
                <T kind="warn">do today · 6h 20m</T>
              </div>
              <div style={{
                fontFamily:"var(--wf-font-hand)",
                fontSize: 30,
                color:"var(--wf-text)",
                lineHeight:1.15,
                marginBottom: 10
              }}>
                Owner picks hook A or B — then Alex finishes main pass &amp; marks review-ready.
              </div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                <span className="wf-btn primary">Pick hook A</span>
                <span className="wf-btn primary">Pick hook B</span>
                <span className="wf-btn">Defer 1h</span>
                <span className="wf-btn">Reassign to PV</span>
              </div>
              <div className="hr"></div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14, fontFamily:"var(--wf-font-mono)", fontSize:10.5 }}>
                <div>
                  <div style={{ color:"var(--wf-text-3)" }}>WHY THIS BLOCKS</div>
                  <div style={{ color:"var(--wf-text-2)" }}>Variant brief is locked to a single hook moment.</div>
                </div>
                <div>
                  <div style={{ color:"var(--wf-text-3)" }}>IF IT SLIPS</div>
                  <div style={{ color:"var(--wf-bad)" }}>Variants miss Friday post window.</div>
                </div>
                <div>
                  <div style={{ color:"var(--wf-text-3)" }}>UNLOCKS</div>
                  <div style={{ color:"var(--wf-ok)" }}>Sam can start 5-variant trial · 24h budget.</div>
                </div>
              </div>
            </div>

            {/* hook A vs B preview */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              {[
                { v:"A · bell ring → crowd wide", retention:"+9 pts vs baseline" },
                { v:"B · low drone → bell ring",  retention:"+4 pts vs baseline" }
              ].map((h,i) => (
                <div key={i} className="tick-box" style={{
                  border:"1px dashed var(--wf-line-2)",
                  borderRadius:4,
                  padding:"10px 12px",
                  display:"flex", flexDirection:"column", gap:6,
                  background:"repeating-linear-gradient(45deg, transparent 0 8px, rgba(255,255,255,0.018) 8px 16px)"
                }}>
                  <div style={{ fontFamily:"var(--wf-font-hand)", fontSize:14, color:"var(--wf-text)" }}>{h.v}</div>
                  <div style={{ height: 60, border:"1px dashed var(--wf-line)", borderRadius:3 }}></div>
                  <div style={{ display:"flex", justifyContent:"space-between" }}>
                    <span style={{fontFamily:"var(--wf-font-mono)", fontSize:10, color:"var(--wf-text-3)"}}>predicted</span>
                    <span style={{fontFamily:"var(--wf-font-mono)", fontSize:10.5, color: i===0 ? "var(--wf-ok)" : "var(--wf-text-2)"}}>{h.retention}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* activity feed (event log) */}
            <div className="box" style={{ flex:1, minHeight:0, overflow:"hidden" }}>
              <div className="h-row">
                <span className="lbl">▣ EVENT LOG · today</span>
                <span style={{fontFamily:"var(--wf-font-mono)", fontSize:10.5, color:"var(--wf-text-3)"}}>14 entries</span>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                {[
                  { t:"11:05", who:"system", e:"REEL-201 entered MAIN EDIT", k:"ok"},
                  { t:"11:42", who:"Alex R", e:"uploaded cut v3.mp4 (1.2GB)", k:"info"},
                  { t:"09:18", who:"Paul V", e:"comment: \"open on bell + crowd surge\"", k:"info"},
                  { t:"10:04", who:"Alex R", e:"posted A/B hook · pinged @PV", k:"warn"},
                  { t:"10:48", who:"system", e:"dep BLOCKER opened: hook A/B (SLA 4h)", k:"bad"},
                  { t:"12:30", who:"Sam K",  e:"variant editor went idle (no active brief)", k:"warn"},
                ].map((l, i) => (
                  <div key={i} style={{
                    display:"grid", gridTemplateColumns:"42px 60px 1fr",
                    gap:8, alignItems:"center",
                    fontFamily:"var(--wf-font-mono)", fontSize:11,
                    padding:"3px 0",
                    color:"var(--wf-text-2)"
                  }}>
                    <span style={{color:"var(--wf-text-3)"}}>{l.t}</span>
                    <span style={{ color: l.k==="bad"?"var(--wf-bad)": l.k==="warn"?"var(--wf-warn)": l.k==="ok"?"var(--wf-ok)":"var(--wf-text-3)" }}>{l.who}</span>
                    <span>{l.e}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT: launch / handoff checklist + variant readiness */}
          <div style={{
            borderLeft:"1px dashed var(--wf-line)",
            padding:"14px", overflow:"hidden",
            display:"flex", flexDirection:"column", gap:12
          }}>
            <div className="box">
              <div className="h-row">
                <span className="lbl">◉ HANDOFF READINESS</span>
                <Pill>0 / 4</Pill>
              </div>
              {[
                { t:"Export main 1080×1920",        s:"pending" },
                { t:"Clean source links attached",  s:"pending" },
                { t:"Allowed variant changes",       s:"pending" },
                { t:"No-touch elements marked",      s:"pending" },
                { t:"Reference board linked",        s:"done" },
                { t:"Frame.io review draft",         s:"in progress" },
              ].map((c, i) => (
                <div key={i} style={{
                  display:"flex", gap:8, alignItems:"center",
                  padding:"5px 0",
                  borderBottom: i < 5 ? "1px dashed var(--wf-line)" : "none",
                  fontSize:12, color:"var(--wf-text-2)"
                }}>
                  <span style={{
                    width:13, height:13,
                    border: c.s==="done" ? "1px solid var(--wf-ok)" : "1px dashed var(--wf-line-2)",
                    borderRadius:3,
                    display:"inline-flex", alignItems:"center", justifyContent:"center",
                    color:"var(--wf-ok)", fontSize:10,
                    flexShrink:0
                  }}>{c.s==="done"?"✓":""}</span>
                  <span style={{flex:1, textDecoration: c.s==="done" ? "line-through" : "none", color: c.s==="done"?"var(--wf-text-3)":"inherit"}}>{c.t}</span>
                  <span style={{
                    fontFamily:"var(--wf-font-mono)",
                    fontSize:9.5,
                    color: c.s==="done"?"var(--wf-ok)":c.s==="in progress"?"var(--wf-warn)":"var(--wf-text-3)"
                  }}>{c.s}</span>
                </div>
              ))}
            </div>

            <div className="box">
              <div className="h-row">
                <span className="lbl">◫ VARIANT READINESS</span>
                <Pill>0 / 5</Pill>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:5 }}>
                {["A","B","C","D","E"].map((v,i) => (
                  <div key={v} style={{
                    aspectRatio: "9/16",
                    border:"1px dashed var(--wf-line)",
                    borderRadius:3,
                    background:"repeating-linear-gradient(45deg, transparent 0 5px, rgba(255,255,255,0.02) 5px 10px)",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontFamily:"var(--wf-font-hand)", fontSize:16, color:"var(--wf-text-3)"
                  }}>{v}</div>
                ))}
              </div>
              <div className="note" style={{ fontSize:11.5, marginTop:8 }}>
                grid lights up as variant editor completes each
              </div>
            </div>

            <div className="box">
              <div className="h-row">
                <span className="lbl">⌥ QUICK ACTIONS</span>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                <span className="wf-btn" style={{justifyContent:"flex-start"}}>+ Attach reference</span>
                <span className="wf-btn" style={{justifyContent:"flex-start"}}>+ Open in NLE</span>
                <span className="wf-btn" style={{justifyContent:"flex-start"}}>+ Ping owner</span>
                <span className="wf-btn danger" style={{justifyContent:"flex-start"}}>! Escalate blocker</span>
              </div>
            </div>
          </div>
        </div>

        <div style={{
          padding:"8px 22px",
          borderTop:"1px dashed var(--wf-line)",
          display:"flex", justifyContent:"space-between",
          fontFamily:"var(--wf-font-mono)", fontSize:10.5, color:"var(--wf-text-3)"
        }}>
          <span>Reel Detail v3 ✦ wild-card · cockpit · ONE clear next action surrounded by telemetry</span>
          <span className="anno">good when there's a single decision blocking a chain</span>
        </div>
      </div>
    </div>
  </div>
);

window.ReelDetailV3 = ReelDetailV3;
