// Pipeline Board v1 — Classic Kanban
// 7 stage columns. Each card shows time-pill, blocker, deps, variant count.
// Annotations along the edges point out the design intent.

const PipelineV1 = () => {
  const columns = [
    {
      name: "Idea Pool", count: 23, sub: "raw + discovery",
      cards: [
        { id:"IDEA-088", title:"Temple bell close-up sequence", concept:"Pashupatinath atmosphere — strong texture", state:"disc", time:"3d in pool", timeKind:"wait", owner:"Alex R", role:"DISCOVERY", attached:"4 selects" },
        { id:"IDEA-087", title:"River ghat evening crowd", concept:"Movement + emotion, opener candidate", state:"disc", time:"1d in pool", timeKind:"wait", owner:"Alex R", role:"DISCOVERY", attached:"7 selects" },
        { id:"IDEA-082", title:"Street food vendor flame closeup", concept:"Sensory hook, ~6s opening", state:"wait", time:"6d in pool", timeKind:"warn", owner:"Paul V", attached:"2 refs" },
        { id:"IDEA-079", title:"Market vendor smile slow-mo", state:"wait", time:"11d in pool", timeKind:"bad", owner:"Paul V" },
      ]
    },
    {
      name: "Selected", count: 4, sub: "queued",
      cards: [
        { id:"REEL-204", title:"Kathmandu chaos / atmosphere", concept:"38s travel reel, devotional energy", state:"ok", time:"queued · 4h", timeKind:"ok", owner:"Alex R", attached:"12 Labs pull", variants:"0/5" },
        { id:"REEL-203", title:"Monastery dawn ritual", concept:"Soft opener, brand-safe", state:"warn", time:"queued · 2d", timeKind:"warn", owner:"Alex R", attached:"3 refs", variants:"0/5" },
      ]
    },
    {
      name: "Main Edit", count: 3, sub: "in progress",
      cards: [
        { id:"REEL-201", title:"Temple crowd sequence", concept:"38s main cut for Kathmandu reel", state:"warn", time:"6h 20m left", timeKind:"warn", owner:"Alex R", attached:"8 selects", variants:"0/5", age:"started 11:05 today", deps:"waiting: owner decision on opening line" },
        { id:"REEL-198", title:"Boudha kora walk", concept:"Slow-pace contemplative cut", state:"bad", time:"19h overdue", timeKind:"bad", owner:"Alex R", blocker:"blocked by owner — hook A vs B unresolved", deps:"music choice locked", variants:"0/5", age:"in stage 3d" },
        { id:"REEL-200", title:"Street food smoke", concept:"Sensory, vertical 1080×1920", state:"ok", time:"22h left", timeKind:"ok", owner:"Alex R", attached:"6 selects", variants:"0/5", age:"started yesterday" },
      ]
    },
    {
      name: "Awaiting Review", count: 2, sub: "/ handoff prep",
      cards: [
        { id:"REEL-195", title:"Sunrise prayer flags", concept:"Owner review pending opening 3s", state:"warn", time:"waiting 3h 10m", timeKind:"warn", owner:"Paul V", attached:"export v3", deps:"owner approval + handoff notes", age:"approval SLA: 6h" },
        { id:"REEL-192", title:"Old Patan alleys", concept:"Hand-off package locked, awaiting sign-off", state:"bad", time:"waiting 28h", timeKind:"bad", owner:"Paul V", attached:"export v2", deps:"variant team idle", age:"⚠ blocking downstream" },
      ]
    },
    {
      name: "Variants", count: 2, sub: "in progress",
      cards: [
        { id:"REEL-188", title:"Himalaya flyover", concept:"5 variant trials, B + D done", state:"ok", time:"22h left", timeKind:"ok", owner:"Sam K", role:"VARIANT", variants:"2/5", attached:"main + brief", age:"started yesterday" },
        { id:"REEL-185", title:"Street barber 60s", concept:"All 5 variants, retention test", state:"warn", time:"4h left", timeKind:"warn", owner:"Sam K", role:"VARIANT", variants:"3/5", attached:"main + brief" },
      ]
    },
    {
      name: "Ready to Post", count: 5, sub: "scheduled",
      cards: [
        { id:"REEL-180", title:"Lalitpur dusk · variants", state:"ok", time:"post in 2h", timeKind:"ok", owner:"Paul V", variants:"5/5", attached:"5 exports" },
        { id:"REEL-178", title:"Annapurna teaser · variants", state:"ok", time:"post tomorrow 9am", timeKind:"ok", owner:"Paul V", variants:"5/5" },
        { id:"REEL-176", title:"Thamel evening · variants", state:"ok", time:"scheduled fri", timeKind:"ok", owner:"Paul V", variants:"5/5" },
      ]
    },
    {
      name: "Posted", count: 147, sub: "last 30d",
      cards: [
        { id:"POST-152", title:"Boudha sunset · A", state:"ok", time:"+138k views", timeKind:"ok", owner:"@pv_films", attached:"IG · TT · YT", age:"posted 2d" },
        { id:"POST-151", title:"Mountain pass crossing · C", state:"ok", time:"+42k · low ret.", timeKind:"warn", owner:"@pv_films", attached:"IG · TT", age:"posted 3d" },
        { id:"POST-149", title:"Market color burst · B", state:"ok", time:"+411k 🔥", timeKind:"ok", owner:"@pv_films", attached:"IG · TT · YT", age:"posted 5d" },
      ]
    },
  ];

  return (
    <div className="wf">
      <WFTopbar crumb="Pipeline · v1 Classic Kanban" />
      <div className="wf-body">
        <WFNav active="pipeline" />
        <div className="wf-main">
          <WFPageHeader
            title="Pipeline Board"
            subtitle="7 stages · 12 reels in flight · 3 blockers · 1 overdue"
            actions={
              <>
                <span className="wf-btn">Filter: All</span>
                <span className="wf-btn">Group: Stage</span>
                <span className="wf-btn">Owner: Anyone</span>
                <span className="wf-btn primary">+ New reel</span>
              </>
            }
          />

          {/* status strip */}
          <div style={{
            display:"flex", gap:14, padding:"10px 22px",
            borderBottom:"1px dashed var(--wf-line)",
            fontFamily:"var(--wf-font-mono)", fontSize:11
          }}>
            <span style={{color:"var(--wf-text-3)"}}>Time signals:</span>
            <T kind="ok">12 healthy</T>
            <T kind="warn">3 approaching</T>
            <T kind="bad">1 overdue</T>
            <T kind="wait">4 waiting</T>
            <span style={{flex:1}}></span>
            <span className="anno">downstream is idle while REEL-192 sits in review →</span>
          </div>

          {/* columns */}
          <div style={{
            flex:1, minHeight:0, display:"flex", gap:10,
            padding:"14px 18px", overflow:"hidden"
          }}>
            {columns.map(c => (
              <div key={c.name} style={{
                flex:"1 1 0", minWidth:0, display:"flex", flexDirection:"column"
              }}>
                <div className="stage-h">
                  <span>
                    <span className="name">{c.name}</span>
                    <div style={{fontFamily:"var(--wf-font-mono)", fontSize:10, color:"var(--wf-text-3)"}}>
                      {c.sub}
                    </div>
                  </span>
                  <span className="count">{c.count}</span>
                </div>
                <div style={{ flex:1, overflow:"hidden" }}>
                  {c.cards.map(card => (
                    <ReelCard key={card.id} {...card} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* footer annotation */}
          <div style={{
            padding:"8px 22px",
            borderTop:"1px dashed var(--wf-line)",
            display:"flex", justifyContent:"space-between",
            fontFamily:"var(--wf-font-mono)", fontSize:10.5, color:"var(--wf-text-3)"
          }}>
            <span>v1 · Classic 7-column kanban · time pill on every card · L-edge accent = urgency</span>
            <span>blocked cards (red) cascade → downstream column is grey/idle</span>
          </div>
        </div>
      </div>
    </div>
  );
};

window.PipelineV1 = PipelineV1;
