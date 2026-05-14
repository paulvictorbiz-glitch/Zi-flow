// Reel Detail v2 — Stage-spine driven
// Stages are the primary navigation. A full-width horizontal stage spine
// at the top with owners + time per stage; below it the contents for the
// active stage. The page IS the workflow.

const ReelDetailV2 = () => {
  const stages = [
    {
      key:"DISC",  name:"Discovery",  state:"done",
      who:"Alex R",   when:"yesterday 14:20", duration:"2h 20m", note:"pulled from 12 Labs"
    },
    {
      key:"SEL",   name:"Selected",   state:"done",
      who:"Paul V",   when:"yesterday 16:40", duration:"4h queue", note:"greenlit + briefed"
    },
    {
      key:"MAIN",  name:"Main edit",  state:"now",
      who:"Alex R",   when:"started 11:05",   duration:"5h 40m / 12h",
      note:"6h 20m to due · hook A/B unresolved"
    },
    {
      key:"REV",   name:"Review / Handoff",  state:"next",
      who:"Paul V",   when:"begins on input", duration:"4h SLA",
      note:"requires handoff package complete"
    },
    {
      key:"VAR",   name:"Variants",   state:"next",
      who:"Sam K",    when:"—",              duration:"24h target",
      note:"5 variants · A/B/C/D/E"
    },
    {
      key:"RDY",   name:"Ready",      state:"next",
      who:"Paul V",   when:"—",              duration:"≤ 24h",
      note:"queued for IG/TT/YT"
    },
    {
      key:"PST",   name:"Posted",     state:"next",
      who:"auto",     when:"—",              duration:"7d window",
      note:"analytics begin tracking"
    },
  ];

  const stageColor = (s) => s === "done" ? "var(--wf-ok)"
    : s === "now" ? "var(--wf-warn)"
    : "var(--wf-line-2)";

  return (
    <div className="wf">
      <WFTopbar crumb="Pipeline / REEL-201 · Temple crowd sequence" />
      <div className="wf-body">
        <WFNav active="main-edits" />
        <div className="wf-main">
          {/* compact header */}
          <div style={{
            padding:"12px 22px 8px",
            borderBottom:"1px dashed var(--wf-line)",
            display:"flex", alignItems:"center", justifyContent:"space-between"
          }}>
            <div>
              <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:2}}>
                <span style={{fontFamily:"var(--wf-font-mono)", fontSize:10.5, color:"var(--wf-text-3)"}}>REEL-201 · v3 cut</span>
                <T kind="warn">6h 20m to main due</T>
                <Pill>blocked · owner decision</Pill>
              </div>
              <h1 style={{ fontFamily:"var(--wf-font-hand)", fontSize:22, fontWeight:400, color:"var(--wf-text)", margin:0 }}>
                Temple crowd sequence
              </h1>
              <div style={{ fontFamily:"var(--wf-font-mono)", fontSize:11, color:"var(--wf-text-3)" }}>
                Kathmandu chaos / atmosphere · 38s · owner Paul Victor · skilled Alex R
              </div>
            </div>
            <div className="wf-actions">
              <span className="wf-btn">⌘ FootageBrain</span>
              <span className="wf-btn">Open in NLE</span>
              <span className="wf-btn primary">Mark review-ready</span>
            </div>
          </div>

          {/* THE SPINE */}
          <div style={{
            padding:"18px 22px 14px",
            borderBottom:"1px dashed var(--wf-line)"
          }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
              <span style={{ fontFamily:"var(--wf-font-mono)", fontSize:10, letterSpacing:"0.14em", color:"var(--wf-text-3)" }}>STAGE SPINE</span>
              <span style={{ fontFamily:"var(--wf-font-mono)", fontSize:10, color:"var(--wf-text-3)" }}>click a stage to view its panel · current = MAIN EDIT</span>
            </div>
            <div style={{
              display:"grid",
              gridTemplateColumns:"repeat(7, 1fr)",
              gap: 0,
              position:"relative"
            }}>
              {/* underline track */}
              <div style={{
                position:"absolute", left:8, right:8, top:14,
                height: 2, background:"var(--wf-line)"
              }}></div>
              {stages.map((s, i) => (
                <div key={s.key} style={{
                  display:"flex", flexDirection:"column", alignItems:"center",
                  gap: 8, position:"relative", padding:"0 4px"
                }}>
                  {/* dot */}
                  <div style={{
                    width: s.state==="now" ? 18 : 12,
                    height: s.state==="now" ? 18 : 12,
                    borderRadius:"50%",
                    background: s.state==="next" ? "var(--wf-bg-2)" : stageColor(s.state),
                    border: `2px solid ${stageColor(s.state)}`,
                    marginTop: s.state==="now" ? -3 : 0,
                    boxShadow: s.state==="now" ? "0 0 0 6px rgba(241,193,74,0.12)" : "none",
                    zIndex: 1
                  }}></div>
                  <div style={{
                    fontFamily:"var(--wf-font-hand)",
                    fontSize: s.state==="now" ? 16 : 14,
                    color: s.state==="next" ? "var(--wf-text-3)" : "var(--wf-text)",
                    fontWeight: s.state==="now" ? 600 : 400,
                    textAlign:"center"
                  }}>{s.name}</div>
                  <div style={{
                    fontFamily:"var(--wf-font-mono)",
                    fontSize:9.5,
                    color: s.state==="next" ? "var(--wf-text-3)" : "var(--wf-text-2)",
                    textAlign:"center"
                  }}>
                    {s.who}<br/>
                    {s.when}<br/>
                    <span style={{color: s.state==="now" ? "var(--wf-warn)" : "inherit"}}>{s.duration}</span>
                  </div>
                  {s.state==="now" ? <Pill variant="active">▼ active</Pill> : null}
                </div>
              ))}
            </div>
          </div>

          {/* MAIN EDIT stage panel — the dominant section */}
          <div style={{ flex:1, minHeight:0, overflow:"hidden",
                       display:"grid", gridTemplateColumns:"260px 1fr 280px" }}>

            {/* left: footage strip */}
            <div style={{ borderRight:"1px dashed var(--wf-line)", padding:"14px", overflow:"hidden", display:"flex", flexDirection:"column", gap:10 }}>
              <div className="h-row">
                <span className="lbl-h">Source spine</span>
                <Pill>8 selects</Pill>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {[
                  { src:"DJI 0214", tc:"00:42→00:50", note:"crowd surge wide" },
                  { src:"DJI 0218", tc:"01:12→01:18", note:"low push-in" },
                  { src:"A7iv 0331", tc:"02:01→02:11", note:"bell ringer face" },
                  { src:"A7iv 0334", tc:"04:55→05:03", note:"prayer flags wipe" },
                  { src:"A7iv 0341", tc:"07:18→07:22", note:"smoke + chant" },
                  { src:"DJI 0223", tc:"09:08→09:14", note:"crane out reveal" },
                ].map((s,i) => (
                  <div key={i} style={{
                    display:"grid", gridTemplateColumns:"54px 1fr",
                    gap:8, padding:"5px 6px",
                    border:"1px dashed var(--wf-line)",
                    borderRadius:4,
                    alignItems:"center"
                  }}>
                    <div className="tick-box" style={{
                      height:30,
                      background:"repeating-linear-gradient(45deg, transparent 0 5px, rgba(255,255,255,0.025) 5px 10px)",
                      borderRadius:3
                    }}></div>
                    <div>
                      <div style={{fontFamily:"var(--wf-font-mono)", fontSize:10, color:"var(--wf-text)"}}>{s.src}</div>
                      <div style={{fontFamily:"var(--wf-font-mono)", fontSize:9.5, color:"var(--wf-text-3)"}}>{s.tc}</div>
                      <div style={{fontSize:10.5, color:"var(--wf-text-2)"}}>{s.note}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="wf-btn" style={{justifyContent:"center"}}>+ pull from FootageBrain</div>
            </div>

            {/* center: the cut work */}
            <div style={{ padding:"14px 18px", overflow:"hidden", display:"flex", flexDirection:"column", gap:12 }}>
              <div className="box">
                <div className="h-row">
                  <span className="lbl-h">Concept · current pass</span>
                  <Pill>v3 · 11:42</Pill>
                </div>
                <div style={{ fontSize:13, color:"var(--wf-text)", lineHeight:1.55 }}>
                  38s travel reel — crowd entering Pashupatinath at dawn. Stronger first 3 seconds, cleaner pacing,
                  devotional energy via ambient bell + low drone.
                </div>
              </div>

              {/* hook decision — the active blocker */}
              <div className="box" style={{ borderColor:"var(--wf-warn)", background:"rgba(241,193,74,0.04)" }}>
                <div className="h-row">
                  <span className="lbl-h" style={{ color:"var(--wf-warn)" }}>⚠ Active decision — hook A vs B</span>
                  <T kind="warn">owner pending 3h 12m</T>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                  {["A · bell ring close-up → crowd wide","B · low drone push-in → bell ring"].map((h, i) => (
                    <div key={i} className="tick-box" style={{
                      height: 120,
                      border:"1px dashed var(--wf-line-2)",
                      borderRadius:4,
                      padding:"8px 10px",
                      display:"flex", flexDirection:"column", justifyContent:"space-between",
                      background:"repeating-linear-gradient(45deg, transparent 0 7px, rgba(255,255,255,0.02) 7px 14px)"
                    }}>
                      <div style={{fontFamily:"var(--wf-font-hand)", fontSize:15, color:"var(--wf-text)"}}>{h}</div>
                      <div className="wf-btn primary" style={{alignSelf:"flex-start"}}>pick hook {i?"B":"A"}</div>
                    </div>
                  ))}
                </div>
                <div className="note" style={{ marginTop:10, fontSize:12 }}>
                  variant editor brief is locked until owner picks · 4h SLA breached if not chosen by 14:00
                </div>
              </div>

              {/* checklist + comments compact */}
              <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, flex:1, minHeight:0, overflow:"hidden"}}>
                <div className="box" style={{overflow:"hidden"}}>
                  <div className="h-row">
                    <span className="lbl-h">Edit checklist</span>
                    <Pill>3 / 6</Pill>
                  </div>
                  {[
                    {d:true, t:"Selects pulled & timecoded"},
                    {d:true, t:"Music bed locked"},
                    {d:true, t:"Rough cut at length"},
                    {d:false, t:"First 3s hook A/B decided"},
                    {d:false, t:"Captions / subtitle style"},
                    {d:false, t:"Final pass · export"},
                  ].map((c, i) => (
                    <div key={i} style={{
                      display:"flex", gap:8, alignItems:"center",
                      padding:"5px 0", fontSize:12.2,
                      color: c.d ? "var(--wf-text-3)" : "var(--wf-text)",
                      textDecoration: c.d ? "line-through" : "none"
                    }}>
                      <span style={{
                        width:13, height:13, border:"1px dashed var(--wf-line-2)",
                        borderRadius:3, display:"inline-flex", alignItems:"center", justifyContent:"center",
                        color:"var(--wf-ok)", fontSize:10
                      }}>{c.d?"✓":""}</span>
                      {c.t}
                    </div>
                  ))}
                </div>
                <div className="box" style={{overflow:"hidden"}}>
                  <div className="h-row">
                    <span className="lbl-h">Latest feedback</span>
                    <Pill>4 new</Pill>
                  </div>
                  {[
                    {who:"PV", t:"Opening frame is soft. Try bell ring + crowd surge.", time:"09:18"},
                    {who:"AR", t:"@PV — A vs B attached, need a pick before 14:00.", time:"10:04", flag:true},
                    {who:"PV", t:"Music drop @ 0:08 is the moment.", time:"09:21"},
                  ].map((c,i) => (
                    <div key={i} style={{ display:"flex", gap:7, padding:"5px 0",
                      borderBottom: i<2 ? "1px dashed var(--wf-line)" : "none"
                    }}>
                      <span className="av">{c.who}</span>
                      <div style={{flex:1}}>
                        <div style={{ fontSize:11.5, color:"var(--wf-text-2)" }}>{c.t}</div>
                        <div style={{ fontFamily:"var(--wf-font-mono)", fontSize:9.5, color:"var(--wf-text-3)" }}>
                          {c.time}{c.flag ? " · awaiting owner reply" : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* right: next stage preview + handoff prep */}
            <div style={{ borderLeft:"1px dashed var(--wf-line)", padding:"14px", overflow:"hidden", display:"flex", flexDirection:"column", gap:12 }}>
              <div className="box">
                <div className="h-row">
                  <span className="lbl">↓ NEXT STAGE — Review</span>
                  <Pill>waits on you</Pill>
                </div>
                <div style={{ fontFamily:"var(--wf-font-hand)", fontSize:15, color:"var(--wf-text)", marginBottom:4 }}>
                  Paul Victor reviews + writes handoff
                </div>
                <div style={{ fontFamily:"var(--wf-font-mono)", fontSize:10.5, color:"var(--wf-text-3)" }}>
                  4h SLA · begins when you mark this review-ready
                </div>
              </div>

              <div className="box">
                <div className="h-row">
                  <span className="lbl-h">Handoff prep</span>
                  <Pill>0 / 4</Pill>
                </div>
                {[
                  "Export 1080×1920 main",
                  "Attach clean source links",
                  "Allowed variant changes",
                  "No-touch elements"
                ].map((c, i) => (
                  <div key={i} style={{
                    display:"flex", gap:8, alignItems:"center",
                    padding:"6px 0",
                    borderBottom: i<3 ? "1px dashed var(--wf-line)" : "none",
                    fontSize:12, color:"var(--wf-text-2)"
                  }}>
                    <span style={{width:13, height:13, border:"1px dashed var(--wf-line-2)", borderRadius:3, flexShrink:0}}></span>
                    {c}
                  </div>
                ))}
              </div>

              <div className="box">
                <div className="h-row">
                  <span className="lbl">↓ DOWNSTREAM IDLE</span>
                  <T kind="bad">at risk</T>
                </div>
                <div style={{ fontSize:12, color:"var(--wf-text-2)", lineHeight:1.4 }}>
                  Sam (variant editor) has <span style={{color:"var(--wf-warn)"}}>3h 20m</span> of work today and no active brief.
                  Variant lane goes idle if main slips past 18:00.
                </div>
              </div>

              <div className="note" style={{ fontSize:12 }}>
                this stage is the bottleneck for the whole week — finish or hand back to owner
              </div>
            </div>
          </div>

          <div style={{
            padding:"8px 22px",
            borderTop:"1px dashed var(--wf-line)",
            display:"flex", justifyContent:"space-between",
            fontFamily:"var(--wf-font-mono)", fontSize:10.5, color:"var(--wf-text-3)"
          }}>
            <span>Reel Detail v2 · stage-spine drives layout · click a stage = its workflow becomes the page</span>
            <span className="anno">decision panel pulled forward when a blocker is active</span>
          </div>
        </div>
      </div>
    </div>
  );
};

window.ReelDetailV2 = ReelDetailV2;
