// Pipeline Board v4 — Wild-card: Timeline-as-spine
// Gantt-style horizontal axis (today + 5 days). Each reel is a bar with
// colored segments per stage. Shows when work will land & where time is bleeding.

const PipelineV4 = () => {
  // Days axis (relative to today). 7 columns, today is index 2.
  const days = [
    { label: "Mon", date: "5/10", past: true },
    { label: "Tue", date: "5/11", past: true },
    { label: "Today", date: "5/12", today: true },
    { label: "Wed", date: "5/13" },
    { label: "Thu", date: "5/14" },
    { label: "Fri", date: "5/15" },
    { label: "Sat", date: "5/16" },
  ];

  // Reels with segments: each segment occupies a stage and a span (start/end as day positions, 0-6, decimals ok)
  const reels = [
    {
      id:"REEL-201", title:"Temple crowd sequence",
      owner:"Alex R", state:"warn",
      segs: [
        { stage:"Selected", from:1.2, to:1.8, kind:"done" },
        { stage:"Main edit", from:1.8, to:2.6, kind:"now warn", label:"6h 20m left · in main" },
        { stage:"Review",    from:2.6, to:3.0, kind:"plan" },
        { stage:"Variants",  from:3.0, to:4.0, kind:"plan" },
        { stage:"Post",      from:4.0, to:4.2, kind:"plan" },
      ],
      milestone: { at: 2.6, label: "main due" }
    },
    {
      id:"REEL-198", title:"Boudha kora walk",
      owner:"Alex R", state:"bad",
      segs: [
        { stage:"Selected", from:0.0, to:0.4, kind:"done" },
        { stage:"Main edit", from:0.4, to:1.8, kind:"done over" },
        { stage:"Main edit (overrun)", from:1.8, to:2.4, kind:"now bad", label:"19h overdue · hook blocked" },
      ],
      milestone: { at: 1.8, label: "missed" }
    },
    {
      id:"REEL-200", title:"Street food smoke",
      owner:"Alex R", state:"ok",
      segs: [
        { stage:"Selected", from:1.0, to:1.5, kind:"done" },
        { stage:"Main edit", from:1.5, to:2.9, kind:"now ok", label:"22h left" },
        { stage:"Review", from:2.9, to:3.3, kind:"plan" },
        { stage:"Variants", from:3.3, to:4.3, kind:"plan" },
        { stage:"Post", from:4.3, to:4.5, kind:"plan" },
      ]
    },
    {
      id:"REEL-195", title:"Sunrise prayer flags",
      owner:"Paul V", state:"warn",
      segs: [
        { stage:"Main edit", from:0.5, to:1.6, kind:"done" },
        { stage:"Review", from:1.6, to:2.1, kind:"now warn", label:"3h 10m waiting" },
        { stage:"Variants", from:2.1, to:3.1, kind:"plan" },
        { stage:"Post", from:3.1, to:3.3, kind:"plan" },
      ]
    },
    {
      id:"REEL-192", title:"Old Patan alleys",
      owner:"Paul V", state:"bad",
      segs: [
        { stage:"Main edit", from:0.0, to:0.8, kind:"done" },
        { stage:"Review", from:0.8, to:1.1, kind:"done over" },
        { stage:"Review (overrun)", from:1.1, to:2.2, kind:"now bad", label:"28h waiting · blocks variants" },
        { stage:"Variants", from:2.2, to:3.2, kind:"plan" },
      ],
      milestone: { at: 1.1, label: "review SLA breached" }
    },
    {
      id:"REEL-188", title:"Himalaya flyover · 5 var",
      owner:"Sam K", state:"ok",
      segs: [
        { stage:"Main edit", from:0.6, to:1.4, kind:"done" },
        { stage:"Review", from:1.4, to:1.7, kind:"done" },
        { stage:"Variants 2/5", from:1.7, to:2.9, kind:"now ok", label:"22h left · 2 of 5 done" },
        { stage:"Post", from:2.9, to:3.1, kind:"plan" },
      ]
    },
    {
      id:"REEL-185", title:"Street barber 60s · 5 var",
      owner:"Sam K", state:"warn",
      segs: [
        { stage:"Main edit", from:0.4, to:1.2, kind:"done" },
        { stage:"Review", from:1.2, to:1.5, kind:"done" },
        { stage:"Variants 3/5", from:1.5, to:2.3, kind:"now warn", label:"4h left · 2 to go" },
        { stage:"Post", from:2.3, to:2.5, kind:"plan" },
      ]
    },
    {
      id:"REEL-180", title:"Lalitpur dusk · ready",
      owner:"Paul V", state:"ok",
      segs: [
        { stage:"Variants 5/5", from:0.5, to:1.7, kind:"done" },
        { stage:"Ready", from:1.7, to:2.1, kind:"now ok", label:"post in 2h" },
        { stage:"Posted", from:2.1, to:2.2, kind:"plan post" },
      ]
    },
    {
      id:"REEL-204", title:"Kathmandu chaos",
      owner:"Alex R", state:"ok",
      segs: [
        { stage:"Selected", from:1.9, to:2.2, kind:"done" },
        { stage:"Main edit", from:2.2, to:3.4, kind:"plan", label:"will start today" },
        { stage:"Review", from:3.4, to:3.7, kind:"plan" },
        { stage:"Variants", from:3.7, to:4.7, kind:"plan" },
        { stage:"Post", from:4.7, to:4.9, kind:"plan" },
      ]
    },
  ];

  // Helpers — convert day offset to %
  const toPct = (n) => (n / days.length) * 100;
  const segColor = (kind) => {
    if (kind.includes("bad"))  return { bg: "rgba(240,123,110,0.28)", brd: "var(--wf-bad)" };
    if (kind.includes("warn")) return { bg: "rgba(241,193,74,0.24)", brd: "var(--wf-warn)" };
    if (kind.includes("now"))  return { bg: "rgba(93,211,158,0.22)", brd: "var(--wf-ok)" };
    if (kind.includes("over")) return { bg: "rgba(240,123,110,0.10)", brd: "var(--wf-bad)" };
    if (kind.includes("done")) return { bg: "rgba(141,150,166,0.22)", brd: "var(--wf-text-2)" };
    if (kind.includes("post")) return { bg: "rgba(111,181,255,0.22)", brd: "var(--wf-active)" };
    return { bg: "rgba(141,150,166,0.10)", brd: "var(--wf-line-2)" }; // plan
  };

  return (
    <div className="wf">
      <WFTopbar crumb="Pipeline · v4 Timeline-Spine ✦ wild-card" />
      <div className="wf-body">
        <WFNav active="pipeline" />
        <div className="wf-main">
          <WFPageHeader
            title="Pipeline · Timeline"
            subtitle="every reel as a bar across days · solid = done · pulsing = now · faint = planned · red = overrun"
            actions={
              <>
                <Pill variant="active">view: timeline</Pill>
                <span className="wf-btn">Window: 7d</span>
                <span className="wf-btn">Group: reel</span>
                <span className="wf-btn primary">+ Schedule reel</span>
              </>
            }
          />

          <div style={{
            display:"flex", gap:14, padding:"8px 22px",
            borderBottom:"1px dashed var(--wf-line)",
            fontFamily:"var(--wf-font-mono)", fontSize:11
          }}>
            <span style={{color:"var(--wf-text-3)"}}>Legend:</span>
            <T kind="ok">in progress</T>
            <T kind="warn">at risk</T>
            <T kind="bad">overrun / blocked</T>
            <T kind="wait">planned</T>
            <span style={{flex:1}}></span>
            <span className="anno">✦ wild-card · operations as a Gantt for content</span>
          </div>

          {/* timeline grid */}
          <div style={{
            flex:1, minHeight:0, display:"flex", flexDirection:"column",
            padding:"10px 18px 0", overflow:"hidden"
          }}>
            {/* day header */}
            <div style={{
              display:"grid",
              gridTemplateColumns:`220px 1fr`,
              borderBottom:"1px dashed var(--wf-line)",
              paddingBottom:6
            }}>
              <div style={{
                fontFamily:"var(--wf-font-mono)", fontSize:10,
                color:"var(--wf-text-3)", letterSpacing:"0.12em",
                textTransform:"uppercase", paddingLeft:4, alignSelf:"end"
              }}>REEL · OWNER</div>
              <div style={{ display:"grid", gridTemplateColumns:`repeat(${days.length}, 1fr)` }}>
                {days.map(d => (
                  <div key={d.label} style={{
                    textAlign:"center",
                    padding:"4px 0",
                    borderLeft: "1px dashed var(--wf-line)",
                    color: d.today ? "var(--wf-warn)" : "var(--wf-text-3)",
                  }}>
                    <div style={{
                      fontFamily:"var(--wf-font-hand)", fontSize:14,
                      color: d.today ? "var(--wf-warn)" : (d.past ? "var(--wf-text-3)" : "var(--wf-text-2)")
                    }}>{d.label}</div>
                    <div style={{ fontFamily:"var(--wf-font-mono)", fontSize:9.5 }}>{d.date}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* rows */}
            <div style={{
              flex:1, minHeight:0, overflow:"hidden",
              display:"flex", flexDirection:"column"
            }}>
              {reels.map(r => (
                <div key={r.id} style={{
                  display:"grid",
                  gridTemplateColumns:"220px 1fr",
                  borderBottom:"1px dashed var(--wf-line)",
                  padding:"10px 0",
                  alignItems:"center"
                }}>
                  {/* left meta */}
                  <div style={{ paddingRight:14 }}>
                    <div style={{display:"flex", gap:6, alignItems:"center"}}>
                      <span className="id" style={{fontFamily:"var(--wf-font-mono)", fontSize:9.5, color:"var(--wf-text-3)"}}>{r.id}</span>
                      <T kind={r.state}>{r.state}</T>
                    </div>
                    <div style={{ fontSize:12.5, color:"var(--wf-text)", fontWeight:500, marginTop:3, lineHeight:1.3 }}>{r.title}</div>
                    <div style={{ display:"flex", gap:5, alignItems:"center", marginTop:3 }}>
                      <span className="av">{r.owner.split(" ").map(s=>s[0]).join("")}</span>
                      <span style={{fontFamily:"var(--wf-font-mono)", fontSize:10.5, color:"var(--wf-text-2)"}}>{r.owner}</span>
                    </div>
                  </div>

                  {/* timeline track */}
                  <div style={{ position:"relative", height: 50,
                    background:"repeating-linear-gradient(90deg, transparent 0, transparent calc(100%/7 - 1px), var(--wf-line) calc(100%/7 - 1px), var(--wf-line) calc(100%/7))"
                  }}>
                    {/* today line */}
                    <div style={{
                      position:"absolute",
                      left: `${toPct(2)}%`,
                      top: 0, bottom: 0,
                      width: 1.5,
                      background:"var(--wf-warn)",
                      opacity: 0.55
                    }}></div>

                    {/* segments */}
                    {r.segs.map((s, i) => {
                      const c = segColor(s.kind);
                      const left = toPct(s.from);
                      const width = toPct(s.to) - toPct(s.from);
                      const isNow = s.kind.includes("now");
                      return (
                        <div key={i} style={{
                          position:"absolute",
                          left: `calc(${left}% + 2px)`,
                          width: `calc(${width}% - 4px)`,
                          top: 10, height: 30,
                          background: c.bg,
                          borderTop: `1px ${s.kind.includes("plan")?"dashed":"solid"} ${c.brd}`,
                          borderBottom: `1px ${s.kind.includes("plan")?"dashed":"solid"} ${c.brd}`,
                          borderLeft: `${isNow ? 2 : 1}px solid ${c.brd}`,
                          borderRadius: 2,
                          padding: "2px 6px",
                          display:"flex", alignItems:"center",
                          overflow:"hidden", whiteSpace:"nowrap",
                          color: "var(--wf-text)",
                          fontSize: 10.5,
                          fontFamily: "var(--wf-font-mono)",
                          gap: 6
                        }}>
                          <span style={{
                            color: c.brd, fontWeight: 600,
                            textTransform: "uppercase", letterSpacing:"0.04em",
                            fontSize: 9.5
                          }}>{s.stage}</span>
                          {s.label ? <span style={{color:"var(--wf-text-2)"}}>· {s.label}</span> : null}
                        </div>
                      );
                    })}

                    {/* milestone marker */}
                    {r.milestone ? (
                      <div style={{
                        position:"absolute",
                        left: `${toPct(r.milestone.at)}%`,
                        top: -2,
                        transform:"translateX(-50%)",
                        color: r.state === "bad" ? "var(--wf-bad)" : "var(--wf-warn)",
                        fontFamily:"var(--wf-font-hand)",
                        fontSize: 11,
                        whiteSpace:"nowrap"
                      }}>
                        ▼ {r.milestone.label}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{
            padding:"8px 22px",
            borderTop:"1px dashed var(--wf-line)",
            display:"flex", justifyContent:"space-between",
            fontFamily:"var(--wf-font-mono)", fontSize:10.5, color:"var(--wf-text-3)"
          }}>
            <span>v4 ✦ wild-card · Timeline / Gantt-spine · production as one continuous schedule</span>
            <span className="anno">downstream gap after REEL-192 is the org's idle window</span>
          </div>
        </div>
      </div>
    </div>
  );
};

window.PipelineV4 = PipelineV4;
