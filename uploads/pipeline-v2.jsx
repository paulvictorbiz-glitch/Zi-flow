// Pipeline Board v2 — Swimlanes by role/owner
// Rows = people, columns = stages. Makes "who is the bottleneck?" immediate.

const PipelineV2 = () => {
  const stages = [
    "Idea Pool", "Selected", "Main Edit",
    "Awaiting Review", "Variants", "Ready", "Posted"
  ];

  const lanes = [
    {
      name: "Alex Rivera",
      role: "SKILLED EDITOR · discovery + main edit",
      load: { active: 3, blocked: 1, due: "2 today" },
      health: "warn",
      cells: {
        "Idea Pool": [
          { id:"IDEA-088", title:"Temple bell close-up", state:"disc", time:"3d", timeKind:"wait" },
          { id:"IDEA-087", title:"River ghat evening crowd", state:"disc", time:"1d", timeKind:"wait" },
        ],
        "Main Edit": [
          { id:"REEL-201", title:"Temple crowd sequence", state:"warn", time:"6h 20m", timeKind:"warn", deps:"owner decision pending" },
          { id:"REEL-198", title:"Boudha kora walk", state:"bad", time:"19h over", timeKind:"bad", blocker:"hook A/B unresolved" },
          { id:"REEL-200", title:"Street food smoke", state:"ok", time:"22h left", timeKind:"ok" },
        ],
      }
    },
    {
      name: "Paul Victor",
      role: "OWNER · approvals + handoff prep",
      load: { active: 0, blocked: 0, due: "approval SLA 6h" },
      health: "bad",
      cells: {
        "Awaiting Review": [
          { id:"REEL-195", title:"Sunrise prayer flags", state:"warn", time:"3h 10m wait", timeKind:"warn" },
          { id:"REEL-192", title:"Old Patan alleys", state:"bad", time:"28h wait", timeKind:"bad", blocker:"blocking downstream" },
        ],
        "Ready": [
          { id:"REEL-180", title:"Lalitpur dusk", state:"ok", time:"post 2h", timeKind:"ok" },
          { id:"REEL-178", title:"Annapurna teaser", state:"ok", time:"tmrw 9am", timeKind:"ok" },
        ],
      }
    },
    {
      name: "Sam Kafle",
      role: "VARIANT EDITOR · 5-variant trials",
      load: { active: 2, blocked: 0, due: "1 today" },
      health: "ok",
      cells: {
        "Variants": [
          { id:"REEL-188", title:"Himalaya flyover · 5 variants", state:"ok", time:"22h left", timeKind:"ok", progress: 40 },
          { id:"REEL-185", title:"Street barber 60s · 5 var", state:"warn", time:"4h left", timeKind:"warn", progress: 60 },
        ],
      }
    },
    {
      name: "Unassigned / Queue",
      role: "shared pool",
      load: { active: 4, blocked: 0, due: "—" },
      health: "ok",
      cells: {
        "Idea Pool": [
          { id:"IDEA-082", title:"Street food vendor flame", state:"wait", time:"6d", timeKind:"warn" },
          { id:"IDEA-079", title:"Market vendor smile", state:"wait", time:"11d aging", timeKind:"bad" },
        ],
        "Selected": [
          { id:"REEL-204", title:"Kathmandu chaos", state:"ok", time:"queued 4h", timeKind:"ok" },
          { id:"REEL-203", title:"Monastery dawn ritual", state:"warn", time:"queued 2d", timeKind:"warn" },
        ],
      }
    },
  ];

  const MiniCard = ({ c }) => (
    <div className={"reel-card s-" + c.state} style={{ padding:"7px 9px 7px 11px", gap:5, marginBottom:6 }}>
      <span className="lside"></span>
      <div className="id" style={{fontSize:9}}>{c.id}</div>
      <div style={{
        fontSize:11.5, color:"var(--wf-text)", lineHeight:1.25,
        fontWeight:500
      }}>{c.title}</div>
      {c.blocker ? <div className="blocker-note" style={{fontSize:11}}>{c.blocker}</div> : null}
      {c.deps ? <div style={{fontFamily:"var(--wf-font-mono)", fontSize:9.5, color:"var(--wf-text-3)"}}>↪ {c.deps}</div> : null}
      <div className="meta" style={{gap:5}}>
        <span className="grow"></span>
        {c.time ? <T kind={c.timeKind}>{c.time}</T> : null}
      </div>
      {typeof c.progress === "number" ? (
        <div className={"prog " + (c.timeKind || "ok")}><i style={{width: c.progress + "%"}}></i></div>
      ) : null}
    </div>
  );

  return (
    <div className="wf">
      <WFTopbar crumb="Pipeline · v2 Swimlanes by owner" />
      <div className="wf-body">
        <WFNav active="pipeline" />
        <div className="wf-main">
          <WFPageHeader
            title="Pipeline · By Owner"
            subtitle="rows = people · columns = stages · answers “who is the bottleneck?” at a glance"
            actions={
              <>
                <Pill variant="active">view: swimlane</Pill>
                <span className="wf-btn">Group: owner</span>
                <span className="wf-btn">Filter: active only</span>
                <span className="wf-btn primary">+ Assign reel</span>
              </>
            }
          />

          {/* time legend */}
          <div style={{
            display:"flex", gap:14, padding:"8px 22px",
            borderBottom:"1px dashed var(--wf-line)",
            fontFamily:"var(--wf-font-mono)", fontSize:11
          }}>
            <span style={{color:"var(--wf-text-3)"}}>Lane health:</span>
            <T kind="ok">healthy</T>
            <T kind="warn">approaching</T>
            <T kind="bad">overdue / blocking</T>
            <span style={{flex:1}}></span>
            <span className="anno">PV's review lane is red — that's the org bottleneck right now</span>
          </div>

          {/* swimlane grid */}
          <div style={{
            flex:1, minHeight:0, overflow:"hidden",
            display:"grid",
            gridTemplateColumns:"180px repeat(7, 1fr)",
          }}>
            {/* header row */}
            <div style={{
              borderBottom:"1px dashed var(--wf-line)",
              borderRight:"1px dashed var(--wf-line)",
              padding:"10px 12px",
              fontFamily:"var(--wf-font-mono)",
              fontSize:10, letterSpacing:"0.12em",
              color:"var(--wf-text-3)", textTransform:"uppercase"
            }}>OWNER · ROLE</div>
            {stages.map(s => (
              <div key={s} style={{
                borderBottom:"1px dashed var(--wf-line)",
                padding:"10px 8px",
                fontFamily:"var(--wf-font-hand)",
                fontSize:13,
                color:"var(--wf-text)"
              }}>{s}</div>
            ))}

            {/* lane rows */}
            {lanes.map((lane, li) => (
              <React.Fragment key={lane.name}>
                <div style={{
                  borderBottom:"1px dashed var(--wf-line)",
                  borderRight:"1px dashed var(--wf-line)",
                  padding:"12px",
                  display:"flex", flexDirection:"column", gap:8,
                  background: lane.health === "bad" ? "rgba(240,123,110,0.04)"
                            : lane.health === "warn" ? "rgba(241,193,74,0.03)"
                            : "transparent"
                }}>
                  <div style={{display:"flex", alignItems:"center", gap:8}}>
                    <span className="av lg">{lane.name.split(" ").map(s=>s[0]).join("")}</span>
                    <div>
                      <div style={{ fontSize:12.5, color:"var(--wf-text)", fontWeight:500 }}>{lane.name}</div>
                      <div style={{
                        fontFamily:"var(--wf-font-mono)",
                        fontSize:9.5, color:"var(--wf-text-3)",
                        letterSpacing:"0.04em"
                      }}>{lane.role}</div>
                    </div>
                  </div>
                  <div style={{display:"flex", gap:5, flexWrap:"wrap"}}>
                    <Pill>active {lane.load.active}</Pill>
                    {lane.load.blocked > 0 ? <span className="t-pill bad">blocked {lane.load.blocked}</span> : null}
                    <Pill>due {lane.load.due}</Pill>
                  </div>
                  {lane.health === "bad" ? (
                    <div className="note" style={{fontSize:12, marginTop:4}}>
                      bottleneck — work piling up here
                    </div>
                  ) : null}
                </div>
                {stages.map((s, si) => (
                  <div key={s} style={{
                    borderBottom:"1px dashed var(--wf-line)",
                    borderRight: si < stages.length-1 ? "1px dashed var(--wf-line)" : "none",
                    padding:"10px 8px",
                    minHeight:0, overflow:"hidden"
                  }}>
                    {(lane.cells[s] || []).map(c => <MiniCard key={c.id} c={c} />)}
                    {!(lane.cells[s] || []).length ? (
                      <div style={{
                        textAlign:"center",
                        fontFamily:"var(--wf-font-mono)",
                        fontSize:10,
                        color:"var(--wf-text-3)",
                        marginTop:18
                      }}>· · ·</div>
                    ) : null}
                  </div>
                ))}
              </React.Fragment>
            ))}
          </div>

          <div style={{
            padding:"8px 22px",
            borderTop:"1px dashed var(--wf-line)",
            display:"flex", justifyContent:"space-between",
            fontFamily:"var(--wf-font-mono)", fontSize:10.5, color:"var(--wf-text-3)"
          }}>
            <span>v2 · Swimlanes · lane background reddens when that owner is the bottleneck</span>
            <span>good for daily standup — eyes scan rows, not columns</span>
          </div>
        </div>
      </div>
    </div>
  );
};

window.PipelineV2 = PipelineV2;
