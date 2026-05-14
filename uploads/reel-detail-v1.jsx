// Reel Detail v1 — Three-pane "operational heart"
// Left: full sidebar nav. Center: concept, references, comments, checklist.
// Right: time status + stage timeline + handoff checklist + variant tracker.

const ReelDetailV1 = () => (
  <div className="wf">
    <WFTopbar crumb="Pipeline / REEL-201 · Temple crowd sequence" />
    <div className="wf-body">
      <WFNav active="main-edits" />
      <div className="wf-main">
        {/* page header w/ stage + state */}
        <div className="wf-pageheader">
          <div>
            <div style={{display:"flex", gap:8, alignItems:"center", marginBottom:4}}>
              <span style={{fontFamily:"var(--wf-font-mono)", fontSize:10.5, color:"var(--wf-text-3)"}}>REEL-201 · v3 cut</span>
              <Pill variant="active">stage: MAIN EDIT</Pill>
              <T kind="warn">6h 20m to main cut due</T>
              <Pill>3 dependencies</Pill>
            </div>
            <h1>Temple crowd sequence</h1>
            <div className="sub">Kathmandu chaos / atmosphere · 38s travel reel · owner Paul Victor</div>
          </div>
          <div className="wf-actions">
            <span className="wf-btn">⌘ Open in FootageBrain</span>
            <span className="wf-btn">Mark review-ready</span>
            <span className="wf-btn primary">Request approval</span>
          </div>
        </div>

        {/* body grid: 3 columns */}
        <div style={{
          flex:1, minHeight:0, display:"grid",
          gridTemplateColumns:"1.4fr 1fr",
          gap: 0,
          overflow:"hidden"
        }}>
          {/* center column */}
          <div style={{ padding:"14px 18px", overflow:"hidden", display:"flex", flexDirection:"column", gap:14 }}>
            {/* concept */}
            <div className="box">
              <div className="h-row">
                <span className="lbl-h">Concept</span>
                <Pill>v3 · last edit 11:42</Pill>
              </div>
              <div style={{ fontSize:13.5, color:"var(--wf-text)", lineHeight:1.5 }}>
                38-second travel reel built around the temple crowd entering Pashupatinath at dawn —
                <span style={{ color:"var(--wf-text-2)" }}> stronger first 3 seconds, cleaner pacing, devotional energy carried by ambient bell + low drone.</span>
              </div>
              <div className="hr"></div>
              <div className="h-row">
                <span className="lbl">GOAL</span>
              </div>
              <div style={{ fontSize:12.5, color:"var(--wf-text-2)" }}>
                Beat baseline retention (52%) by 8pts. Hook within 1.4s. Build a brief variants can A/B reliably.
              </div>
            </div>

            {/* references / source */}
            <div className="box">
              <div className="h-row">
                <span className="lbl-h">References & Source</span>
                <span className="anno">linked from FootageBrain →</span>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:8 }}>
                {[
                  { lbl:"src · DJI 0214", time:"00:42 → 00:50" },
                  { lbl:"src · DJI 0218", time:"01:12 → 01:18" },
                  { lbl:"src · A7iv 0331", time:"02:01 → 02:11" },
                  { lbl:"src · A7iv 0334", time:"04:55 → 05:03" },
                  { lbl:"ref · @everestmedia", time:"35s reel" },
                  { lbl:"ref · @kathmandu_now", time:"hook moment" },
                  { lbl:"12 Labs · semantic", time:"\"prayer + crowd\"" },
                  { lbl:"+ attach", time:"" },
                ].map((s,i) => (
                  <div key={i} className="tick-box" style={{
                    height: 56,
                    border:"1px dashed var(--wf-line)",
                    borderRadius:4,
                    background:"repeating-linear-gradient(45deg, transparent 0 6px, rgba(255,255,255,0.015) 6px 12px)",
                    padding:"6px 8px",
                    display:"flex", flexDirection:"column", justifyContent:"space-between"
                  }}>
                    <span style={{fontFamily:"var(--wf-font-mono)", fontSize:9.5, color:"var(--wf-text-3)"}}>{s.lbl}</span>
                    <span style={{fontFamily:"var(--wf-font-mono)", fontSize:10, color:"var(--wf-text)"}}>{s.time}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* checklist + comments side-by-side */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <div className="box">
                <div className="h-row">
                  <span className="lbl-h">Editor checklist</span>
                  <Pill>3 / 6</Pill>
                </div>
                {[
                  { d:true, txt:"Selects pulled & timecoded" },
                  { d:true, txt:"Music bed locked" },
                  { d:true, txt:"Rough cut at length" },
                  { d:false, txt:"First 3s hook A/B decided" },
                  { d:false, txt:"Captions / subtitle style approved" },
                  { d:false, txt:"Final pass — export package" },
                ].map((c, i) => (
                  <div key={i} style={{
                    display:"flex", gap:8, alignItems:"center",
                    padding:"6px 0",
                    borderBottom: i < 5 ? "1px dashed var(--wf-line)" : "none",
                    color: c.d ? "var(--wf-text-3)" : "var(--wf-text)",
                    textDecoration: c.d ? "line-through" : "none",
                    fontSize:12.5
                  }}>
                    <span style={{
                      width:14, height:14,
                      border:`1px ${c.d?"solid":"dashed"} var(--wf-line-2)`,
                      borderRadius:3,
                      display:"inline-flex", alignItems:"center", justifyContent:"center",
                      color: "var(--wf-ok)", fontSize:11
                    }}>{c.d?"✓":""}</span>
                    {c.txt}
                  </div>
                ))}
              </div>

              <div className="box">
                <div className="h-row">
                  <span className="lbl-h">Comments & feedback</span>
                  <Pill>4 new</Pill>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:9 }}>
                  {[
                    { who:"PV", role:"Owner", text:"First frame feels soft. Try opening on the bell ring + crowd surge.", time:"09:18", flag:"hook decision" },
                    { who:"PV", role:"Owner", text:"Music drop @ 0:08 is the moment — keep that tempo for variants.", time:"09:21" },
                    { who:"AR", role:"Editor", text:"@PV — A vs B hooks attached, need a pick before 14:00.", time:"10:04", flag:"awaiting reply" },
                  ].map((c, i) => (
                    <div key={i} style={{ display:"flex", gap:8 }}>
                      <span className="av">{c.who}</span>
                      <div style={{flex:1}}>
                        <div style={{display:"flex", alignItems:"center", gap:6}}>
                          <span style={{fontSize:11.5, color:"var(--wf-text)", fontWeight:500}}>{c.who}</span>
                          <span style={{fontFamily:"var(--wf-font-mono)", fontSize:9.5, color:"var(--wf-text-3)"}}>{c.role} · {c.time}</span>
                          {c.flag ? <Pill variant="active">{c.flag}</Pill> : null}
                        </div>
                        <div style={{ fontSize:12, color:"var(--wf-text-2)", marginTop:2 }}>{c.text}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="hr"></div>
                <div style={{
                  border:"1px dashed var(--wf-line)",
                  borderRadius:4,
                  padding:"6px 10px",
                  color:"var(--wf-text-3)",
                  fontStyle:"italic",
                  fontSize:12
                }}>Reply or @mention…</div>
              </div>
            </div>
          </div>

          {/* right column — vertical divider */}
          <div style={{
            borderLeft:"1px dashed var(--wf-line)",
            padding:"14px 18px",
            overflow:"hidden",
            display:"flex", flexDirection:"column", gap:12
          }}>
            {/* time status panel */}
            <div className="box" style={{ borderColor:"var(--wf-warn)" }}>
              <div className="h-row">
                <span className="lbl">TIME STATUS</span>
                <T kind="warn">approaching</T>
              </div>
              <div style={{
                fontFamily:"var(--wf-font-mono)",
                fontSize:34, color:"var(--wf-text)",
                lineHeight:1, letterSpacing:"-0.02em", marginBottom:6
              }}>06:20:14</div>
              <div style={{ fontSize:11.5, color:"var(--wf-text-2)" }}>
                until main cut due · started 11:05 today · 12h budget · 5h 40m used
              </div>
              <div className="hr"></div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, fontFamily:"var(--wf-font-mono)", fontSize:11 }}>
                <div><div style={{color:"var(--wf-text-3)", fontSize:10}}>STAGE BUDGET</div><div style={{color:"var(--wf-text)"}}>12h main · 4h review</div></div>
                <div><div style={{color:"var(--wf-text-3)", fontSize:10}}>WILL LAND</div><div style={{color:"var(--wf-warn)"}}>tight · 1h buffer</div></div>
              </div>
            </div>

            {/* stage timeline */}
            <div className="box">
              <div className="h-row">
                <span className="lbl-h">Stage timeline</span>
                <Pill>5 of 7</Pill>
              </div>
              {[
                { lbl:"Discovery → Selected", state:"done", when:"yesterday 16:40 · Alex" },
                { lbl:"Selected → Main edit", state:"done", when:"today 11:05 · auto" },
                { lbl:"Main edit complete", state:"now",  when:"due today 18:00" },
                { lbl:"Awaiting review / handoff prep", state:"next", when:"begins on owner input" },
                { lbl:"Variants in progress", state:"next", when:"blocked until handoff approved" },
                { lbl:"Ready to post", state:"next", when:"—" },
                { lbl:"Posted", state:"next", when:"—" },
              ].map((s, i) => (
                <div key={i} style={{ display:"flex", gap:10, padding:"6px 0", alignItems:"flex-start" }}>
                  <div style={{
                    width:10, height:10, borderRadius:"50%",
                    marginTop:5,
                    background: s.state==="done" ? "var(--wf-ok)" : s.state==="now" ? "var(--wf-warn)" : "transparent",
                    border: s.state==="now" ? "2px solid var(--wf-warn)" : "1px dashed var(--wf-line-2)",
                    flexShrink:0
                  }}></div>
                  <div style={{flex:1}}>
                    <div style={{ fontSize:12.5, color: s.state==="next" ? "var(--wf-text-3)" : "var(--wf-text)", fontWeight: s.state==="now" ? 600 : 400 }}>{s.lbl}</div>
                    <div style={{ fontFamily:"var(--wf-font-mono)", fontSize:10, color:"var(--wf-text-3)" }}>{s.when}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* handoff checklist */}
            <div className="box">
              <div className="h-row">
                <span className="lbl-h">Handoff package</span>
                <Pill>0 / 4</Pill>
              </div>
              {[
                "Export main version (1080×1920 · ProRes + H.264)",
                "Attach clean source links",
                "State allowed variant changes",
                "Mark no-touch elements"
              ].map((c, i) => (
                <div key={i} style={{
                  display:"flex", gap:8, alignItems:"center",
                  padding:"6px 0",
                  borderBottom: i < 3 ? "1px dashed var(--wf-line)" : "none",
                  fontSize:12.5, color:"var(--wf-text-2)"
                }}>
                  <span style={{
                    width:14, height:14, border:"1px dashed var(--wf-line-2)",
                    borderRadius:3, flexShrink:0
                  }}></span>
                  {c}
                </div>
              ))}
              <div className="note" style={{ marginTop:8, fontSize:12 }}>
                variant editor (Sam) is idle until this is complete
              </div>
            </div>

            {/* variant tracker */}
            <div className="box">
              <div className="h-row">
                <span className="lbl-h">Variant batch</span>
                <Pill>0 / 5</Pill>
              </div>
              <div style={{
                display:"grid",
                gridTemplateColumns:"repeat(5, 1fr)",
                gap:6
              }}>
                {["A","B","C","D","E"].map(v => (
                  <div key={v} style={{
                    aspectRatio: "9 / 16",
                    border:"1px dashed var(--wf-line)",
                    borderRadius:4,
                    background:"repeating-linear-gradient(45deg, transparent 0 6px, rgba(255,255,255,0.015) 6px 12px)",
                    display:"flex", flexDirection:"column",
                    alignItems:"center", justifyContent:"center",
                    gap:4
                  }}>
                    <span style={{fontFamily:"var(--wf-font-hand)", fontSize:18, color:"var(--wf-text-3)"}}>{v}</span>
                    <span style={{fontFamily:"var(--wf-font-mono)", fontSize:9, color:"var(--wf-text-3)"}}>pending</span>
                  </div>
                ))}
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
          <span>Reel Detail v1 · classic three-pane · concept-and-comments-center, signals-right</span>
          <span className="anno">right rail is the operations console: time, stage, handoff, variants</span>
        </div>
      </div>
    </div>
  </div>
);

window.ReelDetailV1 = ReelDetailV1;
