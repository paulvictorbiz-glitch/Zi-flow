// Pipeline Board v3 — List/table hybrid
// Every reel is a single row with a horizontal mini-stage-strip showing where it is
// and an inline time pill. Densest format — best for "operator looking at everything".

const PipelineV3 = () => {
  const stages = ["Idea", "Sel", "Main", "Rev", "Var", "Rdy", "Pst"];

  const rows = [
    {
      id:"REEL-201", title:"Temple crowd sequence",
      concept:"38s travel reel · devotional energy", at: 2,
      owner:"Alex R · Skilled", state:"warn",
      time:"6h 20m", timeKind:"warn",
      ageStage:"6h in main",
      variants:"0/5", attached:8, deps:"owner decision on opening line",
      next:"Finish main pass · mark review-ready"
    },
    {
      id:"REEL-198", title:"Boudha kora walk",
      concept:"Slow-pace contemplative cut", at: 2,
      owner:"Alex R · Skilled", state:"bad",
      time:"19h overdue", timeKind:"bad",
      ageStage:"3d in main",
      variants:"0/5", attached:6, deps:"hook A vs B unresolved · music locked",
      blocker:"blocked by owner — needs hook call",
      next:"Owner: pick hook by 14:00"
    },
    {
      id:"REEL-200", title:"Street food smoke",
      concept:"Sensory, vertical 1080×1920", at: 2,
      owner:"Alex R · Skilled", state:"ok",
      time:"22h left", timeKind:"ok",
      ageStage:"4h in main",
      variants:"0/5", attached:6, next:"Continue main pass"
    },
    {
      id:"REEL-195", title:"Sunrise prayer flags",
      concept:"Brand-safe, owner review pending opening 3s", at: 3,
      owner:"Paul V · Owner", state:"warn",
      time:"3h 10m waiting", timeKind:"warn",
      ageStage:"3h in review",
      variants:"0/5", attached:"export v3", deps:"approval + handoff notes",
      next:"PV approves · attach handoff notes"
    },
    {
      id:"REEL-192", title:"Old Patan alleys",
      concept:"Hand-off package locked, awaiting sign-off", at: 3,
      owner:"Paul V · Owner", state:"bad",
      time:"28h waiting", timeKind:"bad",
      ageStage:"28h in review",
      variants:"0/5", attached:"export v2", deps:"variant team idle",
      blocker:"blocking variants — review SLA breached",
      next:"PV: sign off TODAY"
    },
    {
      id:"REEL-188", title:"Himalaya flyover",
      concept:"5 variant trials, B + D done", at: 4,
      owner:"Sam K · Variant", state:"ok",
      time:"22h left", timeKind:"ok",
      ageStage:"1d in variants",
      variants:"2/5", attached:"main + brief", next:"3 more variants by EOD"
    },
    {
      id:"REEL-185", title:"Street barber 60s",
      concept:"Retention test set", at: 4,
      owner:"Sam K · Variant", state:"warn",
      time:"4h left", timeKind:"warn",
      ageStage:"6h in variants",
      variants:"3/5", attached:"main + brief", next:"2 more variants · 4h SLA"
    },
    {
      id:"REEL-180", title:"Lalitpur dusk · 5 variants",
      concept:"Cleared for post · paid + organic split", at: 5,
      owner:"Paul V · Posting", state:"ok",
      time:"post in 2h", timeKind:"ok",
      ageStage:"5h ready",
      variants:"5/5", attached:"5 exports", next:"Schedule IG/TT/YT"
    },
    {
      id:"REEL-204", title:"Kathmandu chaos",
      concept:"Queued · selected today", at: 1,
      owner:"Alex R · Skilled", state:"ok",
      time:"queued 4h", timeKind:"ok",
      ageStage:"4h selected",
      variants:"0/5", attached:"12 Labs pull", next:"Start main edit"
    },
    {
      id:"IDEA-088", title:"Temple bell close-up", discovery: true,
      concept:"Discovery — pulled from raw footage by Alex", at: 0,
      owner:"Alex R · Discovery", state:"disc",
      time:"3d in pool", timeKind:"wait",
      ageStage:"3d aging",
      variants:"—", attached:"4 selects + transcript",
      next:"Owner: greenlight or kill"
    },
    {
      id:"IDEA-079", title:"Market vendor smile slow-mo", discovery: false,
      concept:"Owner-added idea · no brief yet", at: 0,
      owner:"Paul V · Idea", state:"wait",
      time:"11d in pool", timeKind:"bad",
      ageStage:"11d aging",
      variants:"—", attached:"2 refs",
      blocker:"stale — promote or archive",
      next:"Triage today"
    },
  ];

  const StagePips = ({ at, state }) => (
    <div style={{ display:"flex", gap:3, alignItems:"center" }}>
      {stages.map((s, i) => {
        const isAt = i === at;
        const isDone = i < at;
        const color = isAt
          ? (state === "bad" ? "var(--wf-bad)" : state === "warn" ? "var(--wf-warn)" : state === "disc" ? "var(--wf-discovery)" : "var(--wf-ok)")
          : isDone ? "var(--wf-text-3)" : "var(--wf-line)";
        return (
          <div key={s} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
            <div style={{
              width: isAt ? 16 : 10,
              height: 4,
              borderRadius: 2,
              background: color,
              border: isAt ? "none" : `1px ${isDone?"solid":"dashed"} ${color}`
            }}></div>
            <span style={{
              fontFamily:"var(--wf-font-mono)",
              fontSize:8.5,
              color: isAt ? "var(--wf-text)" : "var(--wf-text-3)",
              letterSpacing:"0.04em"
            }}>{s}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="wf">
      <WFTopbar crumb="Pipeline · v3 List+Stage Strip" />
      <div className="wf-body">
        <WFNav active="pipeline" />
        <div className="wf-main">
          <WFPageHeader
            title="Pipeline · Operator List"
            subtitle="every reel · every stage · every time SLA · in one scan"
            actions={
              <>
                <Pill variant="active">view: list</Pill>
                <span className="wf-btn">Sort: urgency</span>
                <span className="wf-btn">Filter: active</span>
                <span className="wf-btn primary">+ New reel</span>
              </>
            }
          />

          {/* table */}
          <div style={{ flex:1, minHeight:0, overflow:"hidden", padding:"4px 18px 0" }}>
            <table className="tbl" style={{ tableLayout:"fixed" }}>
              <colgroup>
                <col style={{width:"22%"}} />
                <col style={{width:"14%"}} />
                <col style={{width:"22%"}} />
                <col style={{width:"11%"}} />
                <col style={{width:"9%"}} />
                <col style={{width:"22%"}} />
              </colgroup>
              <thead>
                <tr>
                  <th>Reel · concept</th>
                  <th>Owner · role</th>
                  <th>Stage / progress</th>
                  <th>Time</th>
                  <th>Vars · ⌘</th>
                  <th>Next action / blocker</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ borderLeft:
                      r.state==="bad" ? "2px solid var(--wf-bad)"
                    : r.state==="warn" ? "2px solid var(--wf-warn)"
                    : r.state==="disc" ? "2px solid var(--wf-discovery)"
                    : r.state==="wait" ? "2px solid var(--wf-wait)"
                    : "2px solid var(--wf-ok)"
                  }}>
                    <td>
                      <div style={{display:"flex", alignItems:"center", gap:8}}>
                        <span className="id" style={{fontFamily:"var(--wf-font-mono)", fontSize:10, color:"var(--wf-text-3)"}}>{r.id}</span>
                        {r.discovery ? <Pill variant="discovery">DISCOVERY</Pill> : null}
                      </div>
                      <div style={{fontSize:12.5, color:"var(--wf-text)", fontWeight:500, marginTop:2}}>{r.title}</div>
                      <div style={{fontSize:11, color:"var(--wf-text-2)", marginTop:1}}>{r.concept}</div>
                    </td>
                    <td>
                      <div style={{display:"flex", alignItems:"center", gap:6}}>
                        <span className="av">{r.owner.split(" ").map(s=>s[0]).join("").slice(0,2)}</span>
                        <span style={{fontSize:11.5, color:"var(--wf-text)"}}>{r.owner.split(" · ")[0]}</span>
                      </div>
                      <div style={{fontFamily:"var(--wf-font-mono)", fontSize:9.5, color:"var(--wf-text-3)", marginTop:2, marginLeft:26}}>
                        {r.owner.split(" · ")[1]}
                      </div>
                    </td>
                    <td>
                      <StagePips at={r.at} state={r.state} />
                      <div style={{fontFamily:"var(--wf-font-mono)", fontSize:9.5, color:"var(--wf-text-3)", marginTop:4}}>
                        {r.ageStage}
                      </div>
                    </td>
                    <td><T kind={r.timeKind}>{r.time}</T></td>
                    <td>
                      <div style={{fontFamily:"var(--wf-font-mono)", fontSize:11, color:"var(--wf-text)"}}>{r.variants}</div>
                      <div style={{fontFamily:"var(--wf-font-mono)", fontSize:9.5, color:"var(--wf-text-3)"}}>⌘ {r.attached}</div>
                    </td>
                    <td>
                      {r.blocker ? <div className="blocker-note" style={{fontSize:11.5}}>{r.blocker}</div> : null}
                      {r.deps ? <div style={{fontFamily:"var(--wf-font-mono)", fontSize:10, color:"var(--wf-text-3)", marginBottom:3}}>↪ {r.deps}</div> : null}
                      <div style={{fontSize:11.5, color:"var(--wf-text-2)"}}>{r.next}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{
            padding:"8px 22px",
            borderTop:"1px dashed var(--wf-line)",
            display:"flex", justifyContent:"space-between",
            fontFamily:"var(--wf-font-mono)", fontSize:10.5, color:"var(--wf-text-3)"
          }}>
            <span>v3 · List+stage-strip · highest density, sortable by urgency · best for the morning sweep</span>
            <span className="anno">left border = urgency · stage strip = where in pipeline</span>
          </div>
        </div>
      </div>
    </div>
  );
};

window.PipelineV3 = PipelineV3;
