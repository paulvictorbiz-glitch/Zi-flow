// Dashboard Home, My Work, and Analytics — supporting wireframes
// One wireframe per page (Pipeline + Reel Detail are where the variations live).

// =============================================================
// DASHBOARD
// =============================================================
const DashboardWF = () => (
  <div className="wf">
    <WFTopbar crumb="Dashboard · today" />
    <div className="wf-body">
      <WFNav active="dashboard" />
      <div className="wf-main">
        <WFPageHeader
          title="Operations · today"
          subtitle="Tue · May 12 · 12:18 KTM · Paul Victor"
          actions={
            <>
              <span className="wf-btn">Window: today</span>
              <span className="wf-btn">All accounts</span>
              <span className="wf-btn primary">⚡ Triage queue (4)</span>
            </>
          }
        />

        {/* top alert strip */}
        <div style={{
          display:"flex", alignItems:"center", gap:10,
          padding:"10px 22px",
          borderBottom:"1px dashed var(--wf-line)",
          background:"rgba(240,123,110,0.05)"
        }}>
          <span style={{
            width:8, height:8, borderRadius:"50%", background:"var(--wf-bad)"
          }}></span>
          <span style={{ fontFamily:"var(--wf-font-mono)", fontSize:11.5, color:"var(--wf-bad)", letterSpacing:"0.06em" }}>BOTTLENECK</span>
          <span style={{ fontSize:13, color:"var(--wf-text)" }}>
            Paul Victor's review queue is the bottleneck — 2 reels waiting, oldest <b>28h overdue</b>, variant editor will idle in 3h 20m.
          </span>
          <span style={{flex:1}}></span>
          <span className="wf-btn primary">Open review queue</span>
        </div>

        <div style={{ flex:1, minHeight:0, overflow:"hidden",
                     display:"grid",
                     gridTemplateColumns:"1.4fr 1fr",
                     gap:0
        }}>
          {/* LEFT */}
          <div style={{ padding:"14px 18px", overflow:"hidden",
                       display:"flex", flexDirection:"column", gap:14 }}>
            {/* KPI strip */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:10 }}>
              {[
                { lab:"REELS IN FLIGHT", num:"12", sub:"3 main · 2 review · 2 var · 5 ready", color:null },
                { lab:"OVERDUE",         num:"01", sub:"REEL-198 · 19h over", color:"var(--wf-bad)" },
                { lab:"WAITING ON PV",   num:"02", sub:"approval · 28h max", color:"var(--wf-bad)" },
                { lab:"READY TO POST",   num:"05", sub:"next post in 2h", color:"var(--wf-ok)" },
              ].map((k, i) => (
                <div key={i} className="box">
                  <div className="kpi-lbl">{k.lab}</div>
                  <div className="kpi-num" style={k.color ? {color: k.color} : null}>{k.num}</div>
                  <div className="kpi-sub">{k.sub}</div>
                </div>
              ))}
            </div>

            {/* Bottleneck widget */}
            <div className="box">
              <div className="h-row">
                <span className="lbl-h">Where is work stuck?</span>
                <span style={{fontFamily:"var(--wf-font-mono)", fontSize:10.5, color:"var(--wf-text-3)"}}>last refreshed 1m ago</span>
              </div>
              <div style={{ display:"flex", gap:8, alignItems:"flex-end", height: 140, padding:"0 6px" }}>
                {[
                  { stage:"Idea", count: 4, height: 35, kind:"wait" },
                  { stage:"Selected", count: 2, height: 18, kind:"ok" },
                  { stage:"Main edit", count: 3, height: 45, kind:"warn" },
                  { stage:"Review", count: 2, height: 80, kind:"bad" },
                  { stage:"Variants", count: 2, height: 22, kind:"ok" },
                  { stage:"Ready", count: 5, height: 30, kind:"ok" },
                  { stage:"Posted", count: 147, height: 60, kind:"ok" },
                ].map((b, i) => {
                  const c = b.kind==="bad"?"var(--wf-bad)":b.kind==="warn"?"var(--wf-warn)":b.kind==="wait"?"var(--wf-wait)":"var(--wf-ok)";
                  return (
                    <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
                      <span style={{fontFamily:"var(--wf-font-mono)", fontSize:11.5, color:"var(--wf-text)"}}>{b.count}</span>
                      <div style={{
                        width:"70%",
                        height: `${b.height}%`,
                        background: `repeating-linear-gradient(45deg, transparent 0 4px, ${c}30 4px 8px)`,
                        borderTop:`2px solid ${c}`,
                        borderRadius:"2px 2px 0 0"
                      }}></div>
                      <span style={{fontFamily:"var(--wf-font-hand)", fontSize:12, color:"var(--wf-text-2)"}}>{b.stage}</span>
                    </div>
                  );
                })}
              </div>
              <div className="note" style={{ marginTop:8, fontSize:12 }}>
                review stage is towering — every other column waits on it
              </div>
            </div>

            {/* Aging items */}
            <div className="box">
              <div className="h-row">
                <span className="lbl-h">Aging items · stalled too long</span>
                <Pill>4 over SLA</Pill>
              </div>
              <table className="tbl">
                <thead><tr><th>Reel</th><th>Stage</th><th>Age</th><th>Owner</th><th>Action</th></tr></thead>
                <tbody>
                  {[
                    { id:"REEL-192", t:"Old Patan alleys", stage:"Review", age:"28h", o:"Paul V", k:"bad", a:"sign off" },
                    { id:"REEL-198", t:"Boudha kora walk", stage:"Main edit", age:"3d", o:"Alex R", k:"bad", a:"unblock hook" },
                    { id:"IDEA-079", t:"Market vendor smile", stage:"Idea pool", age:"11d", o:"queue", k:"bad", a:"triage" },
                    { id:"IDEA-082", t:"Street food flame", stage:"Idea pool", age:"6d", o:"queue", k:"warn", a:"triage" },
                  ].map((r, i) => (
                    <tr key={i}>
                      <td>
                        <span style={{fontFamily:"var(--wf-font-mono)", fontSize:9.5, color:"var(--wf-text-3)"}}>{r.id}</span>
                        <div style={{ fontSize:12.5, color:"var(--wf-text)" }}>{r.t}</div>
                      </td>
                      <td><Pill>{r.stage}</Pill></td>
                      <td><T kind={r.k}>{r.age}</T></td>
                      <td>{r.o}</td>
                      <td><span className="wf-btn">{r.a} →</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* RIGHT */}
          <div style={{
            borderLeft:"1px dashed var(--wf-line)",
            padding:"14px 18px", overflow:"hidden",
            display:"flex", flexDirection:"column", gap:12
          }}>
            <div className="box">
              <div className="h-row">
                <span className="lbl-h">Who waits on whom</span>
                <Pill>now</Pill>
              </div>
              {[
                { from:"Alex R · Skilled", to:"Paul V · Owner",   reel:"REEL-201 hook A/B", wait:"3h 12m", k:"warn" },
                { from:"Sam K · Variant",  to:"Paul V · Owner",   reel:"REEL-192 sign-off", wait:"28h", k:"bad" },
                { from:"Paul V · Owner",   to:"Alex R · Skilled", reel:"REEL-198 hook call", wait:"19h", k:"bad" },
                { from:"Idea queue",       to:"Paul V · Owner",   reel:"4 ideas triage",     wait:"6–11d", k:"warn" },
              ].map((w, i) => (
                <div key={i} style={{
                  display:"grid",
                  gridTemplateColumns:"1fr auto 1fr",
                  alignItems:"center", gap:8,
                  padding:"7px 0",
                  borderBottom: i<3 ? "1px dashed var(--wf-line)" : "none"
                }}>
                  <div>
                    <div style={{fontSize:12, color:"var(--wf-text)"}}>{w.from}</div>
                    <div style={{fontFamily:"var(--wf-font-mono)", fontSize:10, color:"var(--wf-text-3)"}}>{w.reel}</div>
                  </div>
                  <div style={{
                    fontFamily:"var(--wf-font-mono)", fontSize:11,
                    color: w.k==="bad"?"var(--wf-bad)":"var(--wf-warn)"
                  }}>{w.wait} →</div>
                  <div style={{ fontSize:12, color:"var(--wf-text)", textAlign:"right" }}>{w.to}</div>
                </div>
              ))}
            </div>

            <div className="box">
              <div className="h-row">
                <span className="lbl-h">Recent performance · 7d</span>
                <Pill>vs last week +18%</Pill>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 }}>
                {[
                  { lab:"VIEWS", v:"1.42M", d:"+18%" },
                  { lab:"AVG WATCH", v:"58%", d:"+4 pts" },
                  { lab:"SAVES", v:"6.8k", d:"+12%" },
                  { lab:"FOLLOWERS", v:"+2,134", d:"+9%" },
                ].map((m, i) => (
                  <div key={i} style={{
                    border:"1px dashed var(--wf-line)",
                    borderRadius:4, padding:"7px 9px"
                  }}>
                    <div style={{fontFamily:"var(--wf-font-mono)", fontSize:9.5, color:"var(--wf-text-3)", letterSpacing:"0.1em"}}>{m.lab}</div>
                    <div style={{fontFamily:"var(--wf-font-mono)", fontSize:16, color:"var(--wf-text)"}}>{m.v}</div>
                    <div style={{fontFamily:"var(--wf-font-mono)", fontSize:10, color:"var(--wf-ok)"}}>{m.d}</div>
                  </div>
                ))}
              </div>
              {/* sparkline */}
              <div style={{ height: 50, position:"relative", border:"1px dashed var(--wf-line)", borderRadius:4 }}>
                <svg width="100%" height="100%" viewBox="0 0 200 50" preserveAspectRatio="none">
                  <polyline fill="none" stroke="var(--wf-active)" strokeWidth="1.2" strokeDasharray="3,2"
                    points="0,40 20,38 40,32 60,30 80,33 100,24 120,22 140,18 160,20 180,14 200,12"/>
                </svg>
              </div>
            </div>

            <div className="box">
              <div className="h-row">
                <span className="lbl-h">What needs attention today</span>
              </div>
              {[
                { t:"Sign off REEL-192 (28h waiting)", k:"bad" },
                { t:"Pick hook A/B for REEL-201 before 14:00", k:"warn" },
                { t:"Triage 4 stale ideas (>5d in pool)", k:"warn" },
                { t:"Schedule 2 ready reels for tomorrow", k:"ok" },
              ].map((a, i) => (
                <div key={i} style={{
                  display:"flex", alignItems:"center", gap:8,
                  padding:"6px 0",
                  borderBottom: i<3 ? "1px dashed var(--wf-line)" : "none",
                  fontSize:12.5
                }}>
                  <span style={{
                    width:6, height:6, borderRadius:"50%",
                    background: a.k==="bad"?"var(--wf-bad)":a.k==="warn"?"var(--wf-warn)":"var(--wf-ok)"
                  }}></span>
                  <span style={{flex:1, color:"var(--wf-text)"}}>{a.t}</span>
                  <span style={{fontFamily:"var(--wf-font-mono)", fontSize:10, color:"var(--wf-text-3)"}}>→</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{
          padding:"8px 22px",
          borderTop:"1px dashed var(--wf-line)",
          display:"flex", justifyContent:"space-between",
          fontFamily:"var(--wf-font-mono)", fontSize:10.5, color:"var(--wf-text-3)"
        }}>
          <span>Dashboard · answers: where is work stuck, who's the bottleneck, what's overdue</span>
          <span className="anno">red alert strip sits above all KPIs when an SLA is breached</span>
        </div>
      </div>
    </div>
  </div>
);

window.DashboardWF = DashboardWF;


// =============================================================
// MY WORK
// =============================================================
const MyWorkWF = () => (
  <div className="wf">
    <WFTopbar crumb="My Work · Alex Rivera" />
    <div className="wf-body">
      <WFNav active="my-work" />
      <div className="wf-main">
        <WFPageHeader
          title="My Work · Alex Rivera"
          subtitle="skilled editor · 5 active · 1 overdue · 2 today"
          actions={
            <>
              <span className="wf-btn">Role: Skilled editor</span>
              <span className="wf-btn primary">▶ Start focused session</span>
            </>
          }
        />

        {/* time-block KPIs */}
        <div style={{
          display:"grid", gridTemplateColumns:"repeat(5, 1fr)",
          gap:10, padding:"12px 22px",
          borderBottom:"1px dashed var(--wf-line)"
        }}>
          {[
            { lab:"DO TODAY",       num:"02", sub:"main pass + hook", color:"var(--wf-warn)" },
            { lab:"OVERDUE",        num:"01", sub:"REEL-198", color:"var(--wf-bad)" },
            { lab:"WAITING ON ME",  num:"02", sub:"1 hook · 1 reply", color:"var(--wf-warn)" },
            { lab:"I'M BLOCKING",   num:"01", sub:"Sam K idle 3h", color:"var(--wf-bad)" },
            { lab:"DONE THIS WK",   num:"05", sub:"reels unlocked",  color:"var(--wf-ok)" },
          ].map((k, i) => (
            <div key={i} className="box">
              <div className="kpi-lbl">{k.lab}</div>
              <div className="kpi-num" style={{color: k.color}}>{k.num}</div>
              <div className="kpi-sub">{k.sub}</div>
            </div>
          ))}
        </div>

        {/* two-col task lists */}
        <div style={{ flex:1, minHeight:0, overflow:"hidden",
                     display:"grid", gridTemplateColumns:"1.4fr 1fr" }}>

          <div style={{ padding:"14px 18px", overflow:"hidden",
                       display:"flex", flexDirection:"column", gap:12 }}>

            <div className="box">
              <div className="h-row">
                <span className="lbl-h">Must move today</span>
                <Pill variant="active">3 timecards</Pill>
              </div>
              {[
                {
                  id:"REEL-198", t:"Boudha kora walk — finish main pass",
                  why:"19h overdue · blocked on hook A/B (pinged PV)", k:"bad",
                  time:"19h overdue", role:"main edit"
                },
                {
                  id:"REEL-201", t:"Temple crowd sequence — finalize main",
                  why:"6h 20m to due · hook decision pending owner", k:"warn",
                  time:"6h 20m left", role:"main edit"
                },
                {
                  id:"IDEA-087", t:"River ghat evening — brief + selects for greenlight",
                  why:"discovery item · pulled from raw footage 1d ago", k:"ok",
                  time:"1d in pool", role:"discovery"
                },
              ].map((c, i) => (
                <div key={i} style={{
                  display:"grid", gridTemplateColumns:"3px 1fr auto",
                  gap:12, padding:"10px 4px",
                  borderBottom: i<2 ? "1px dashed var(--wf-line)" : "none"
                }}>
                  <div style={{
                    background: c.k==="bad"?"var(--wf-bad)":c.k==="warn"?"var(--wf-warn)":"var(--wf-ok)",
                    borderRadius:2
                  }}></div>
                  <div>
                    <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                      <span style={{fontFamily:"var(--wf-font-mono)", fontSize:9.5, color:"var(--wf-text-3)"}}>{c.id}</span>
                      <Pill>{c.role}</Pill>
                    </div>
                    <div style={{ fontSize:13.5, color:"var(--wf-text)", fontWeight:500, margin:"3px 0 2px" }}>{c.t}</div>
                    <div style={{ fontSize:11.5, color:"var(--wf-text-2)" }}>{c.why}</div>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:5 }}>
                    <T kind={c.k}>{c.time}</T>
                    <span className="wf-btn">Open →</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="box">
              <div className="h-row">
                <span className="lbl-h">My discovery queue</span>
                <Pill variant="discovery">4 candidates</Pill>
              </div>
              {[
                { t:"Temple bell close-up sequence",  age:"3d", note:"strong texture · sensory" },
                { t:"River ghat evening crowd",       age:"1d", note:"opener candidate" },
                { t:"Pashupatinath smoke sequence",   age:"5d", note:"high viral potential · needs brief" },
                { t:"Monastery dawn ritual",          age:"2d", note:"brand-safe · soft opener" },
              ].map((d, i) => (
                <div key={i} style={{
                  display:"flex", alignItems:"center", gap:10,
                  padding:"7px 0",
                  borderBottom: i<3 ? "1px dashed var(--wf-line)" : "none"
                }}>
                  <span style={{ color:"var(--wf-discovery)" }}>◇</span>
                  <div style={{flex:1}}>
                    <div style={{fontSize:12.5, color:"var(--wf-text)"}}>{d.t}</div>
                    <div style={{fontFamily:"var(--wf-font-mono)", fontSize:10, color:"var(--wf-text-3)"}}>{d.note}</div>
                  </div>
                  <span style={{fontFamily:"var(--wf-font-mono)", fontSize:10.5, color:"var(--wf-text-3)"}}>{d.age}</span>
                  <span className="wf-btn">Promote</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{
            borderLeft:"1px dashed var(--wf-line)",
            padding:"14px 18px", overflow:"hidden",
            display:"flex", flexDirection:"column", gap:12
          }}>
            <div className="box">
              <div className="h-row">
                <span className="lbl-h">Waiting on me</span>
                <T kind="warn">2</T>
              </div>
              {[
                { t:"PV: pick hook A/B on REEL-201", wait:"3h 12m", k:"warn" },
                { t:"Sam: needs handoff notes on REEL-195", wait:"5h", k:"warn" },
              ].map((w, i) => (
                <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0",
                  borderBottom: i<1 ? "1px dashed var(--wf-line)" : "none", fontSize:12.5 }}>
                  <span style={{color:"var(--wf-text)"}}>{w.t}</span>
                  <T kind={w.k}>{w.wait}</T>
                </div>
              ))}
            </div>

            <div className="box" style={{ borderColor:"var(--wf-bad)" }}>
              <div className="h-row">
                <span className="lbl" style={{ color:"var(--wf-bad)" }}>I AM BLOCKING</span>
                <T kind="bad">1</T>
              </div>
              <div style={{ fontSize:13, color:"var(--wf-text)" }}>Sam K · variant editor</div>
              <div style={{ fontFamily:"var(--wf-font-mono)", fontSize:10.5, color:"var(--wf-text-3)", marginTop:3 }}>
                idle in 3h 20m · waiting on REEL-201 handoff
              </div>
              <div className="hr"></div>
              <div className="note" style={{ fontSize:12 }}>
                shipping REEL-201 today unblocks the whole variant lane
              </div>
            </div>

            <div className="box">
              <div className="h-row">
                <span className="lbl-h">Recently done</span>
                <Pill>5 this week</Pill>
              </div>
              {[
                { t:"REEL-188 main · handoff", when:"yesterday", k:"ok"},
                { t:"REEL-185 main · handoff", when:"Mon",       k:"ok"},
                { t:"REEL-180 main · handoff", when:"Mon",       k:"ok"},
                { t:"IDEA-082 promoted",       when:"last Fri",  k:"ok"},
              ].map((c, i) => (
                <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", fontSize:12 }}>
                  <span style={{color:"var(--wf-text-2)", textDecoration:"line-through"}}>{c.t}</span>
                  <span style={{fontFamily:"var(--wf-font-mono)", fontSize:10, color:"var(--wf-text-3)"}}>{c.when}</span>
                </div>
              ))}
            </div>

            <div className="box">
              <div className="h-row">
                <span className="lbl-h">Personal scorecard · 30d</span>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                {[
                  { lab:"ON-TIME COMP.", v:"83%" },
                  { lab:"DISC → CUT",    v:"2.4h" },
                  { lab:"REVISIONS",     v:"1.3 avg" },
                  { lab:"UNLOCKED / WK", v:"5" },
                ].map((m, i) => (
                  <div key={i}>
                    <div style={{fontFamily:"var(--wf-font-mono)", fontSize:9.5, color:"var(--wf-text-3)", letterSpacing:"0.1em"}}>{m.lab}</div>
                    <div style={{fontFamily:"var(--wf-font-mono)", fontSize:18, color:"var(--wf-text)"}}>{m.v}</div>
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
          <span>My Work · role-aware · skilled editor shows discovery queue · variant editor would show batch board</span>
          <span className="anno">"I am blocking" tile inverts accountability</span>
        </div>
      </div>
    </div>
  </div>
);

window.MyWorkWF = MyWorkWF;


// =============================================================
// ANALYTICS — variant A/B comparison emphasis
// =============================================================
const AnalyticsWF = () => (
  <div className="wf">
    <WFTopbar crumb="Analytics · variant A/B comparison" />
    <div className="wf-body">
      <WFNav active="analytics" />
      <div className="wf-main">
        <WFPageHeader
          title="Analytics · which variants win"
          subtitle="operational, not vanity · trailing 30d · 6 main reels · 30 variants posted"
          actions={
            <>
              <span className="wf-btn">Period: 30d</span>
              <span className="wf-btn">Account: all</span>
              <span className="wf-btn">Baseline: 30d median</span>
            </>
          }
        />

        <div style={{
          display:"grid", gridTemplateColumns:"repeat(5, 1fr)",
          gap:10, padding:"12px 22px",
          borderBottom:"1px dashed var(--wf-line)"
        }}>
          {[
            { lab:"REELS POSTED", v:"30" },
            { lab:"AVG VIEWS",    v:"47.3k", d:"+18%" },
            { lab:"AVG WATCH%",   v:"58%",   d:"+4 pts" },
            { lab:"AVG SAVES",    v:"226",   d:"+12%" },
            { lab:"FOLLOWERS +",  v:"+8.4k", d:"+9%" },
          ].map((k, i) => (
            <div key={i} className="box">
              <div className="kpi-lbl">{k.lab}</div>
              <div className="kpi-num">{k.v}</div>
              {k.d ? <div className="kpi-sub" style={{color:"var(--wf-ok)"}}>{k.d}</div> : null}
            </div>
          ))}
        </div>

        <div style={{ flex:1, minHeight:0, overflow:"hidden",
                     display:"grid", gridTemplateColumns:"1.3fr 1fr" }}>

          {/* LEFT — per-reel A/B comparison */}
          <div style={{ padding:"14px 18px", overflow:"hidden",
                       display:"flex", flexDirection:"column", gap:14 }}>
            <div className="box">
              <div className="h-row">
                <span className="lbl-h">REEL-180 · Lalitpur dusk — variant A/B/C/D/E</span>
                <span style={{fontFamily:"var(--wf-font-mono)", fontSize:10.5, color:"var(--wf-text-3)"}}>posted 7d ago · 5 variants</span>
              </div>

              <table className="tbl">
                <thead>
                  <tr>
                    <th>Variant</th>
                    <th>Hook pattern</th>
                    <th>Views</th>
                    <th>Watch %</th>
                    <th>Saves</th>
                    <th>vs base</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { v:"Baseline · 30d median", h:"—",                            views:"38.2k", w:"54%", s:"180", d:"—", k:"baseline" },
                    { v:"A · bell + crowd surge", h:"close-up → wide reveal",     views:"94.1k", w:"68%", s:"412", d:"+146%", k:"winner" },
                    { v:"B · drone push-in",     h:"low drone → bell ring",      views:"42.0k", w:"56%", s:"190", d:"+10%", k:"" },
                    { v:"C · captions cold-open",h:"text overlay → action",      views:"71.3k", w:"61%", s:"288", d:"+87%", k:"" },
                    { v:"D · slow-mo entry",     h:"face slow-mo → tempo break", views:"22.4k", w:"43%", s:"71",  d:"−42%", k:"loser" },
                    { v:"E · vertical pano",     h:"pan → reveal",               views:"55.6k", w:"59%", s:"244", d:"+46%", k:"" },
                  ].map((r, i) => (
                    <tr key={i} style={{ background:
                      r.k==="winner" ? "rgba(93,211,158,0.06)"
                      : r.k==="loser" ? "rgba(240,123,110,0.05)"
                      : "transparent"
                    }}>
                      <td>
                        <div style={{fontFamily:"var(--wf-font-mono)", fontSize:11.5, color: r.k==="baseline"?"var(--wf-text-3)":"var(--wf-text)"}}>{r.v}</div>
                        {r.k==="winner" ? <Pill variant="active" style={{marginTop:3}}>★ winner</Pill> : null}
                      </td>
                      <td>{r.h}</td>
                      <td>{r.views}</td>
                      <td>{r.w}</td>
                      <td>{r.s}</td>
                      <td style={{
                        fontFamily:"var(--wf-font-mono)",
                        color: r.k==="winner" ? "var(--wf-ok)" : r.k==="loser" ? "var(--wf-bad)" : r.k==="baseline" ? "var(--wf-text-3)" : "var(--wf-text-2)"
                      }}>{r.d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="note" style={{ marginTop:10, fontSize:12 }}>
                Variant A "close-up → wide reveal" wins 3 metrics — promote this pattern as a template
              </div>
            </div>

            <div className="box">
              <div className="h-row">
                <span className="lbl-h">Watch retention curve · A vs B vs baseline</span>
                <Pill>0–38s</Pill>
              </div>
              {/* sketch retention chart */}
              <div style={{ height: 130, position:"relative", border:"1px dashed var(--wf-line)", borderRadius:4 }}>
                <svg width="100%" height="100%" viewBox="0 0 400 130" preserveAspectRatio="none">
                  {/* grid */}
                  {[0.25, 0.5, 0.75].map(g => (
                    <line key={g} x1="0" y1={130*g} x2="400" y2={130*g} stroke="var(--wf-line)" strokeDasharray="2,3" strokeWidth="0.5"/>
                  ))}
                  {/* baseline */}
                  <polyline fill="none" stroke="var(--wf-text-3)" strokeWidth="1.4" strokeDasharray="4,3"
                    points="0,10 50,18 100,30 150,48 200,68 250,88 300,100 350,108 400,114"/>
                  {/* B */}
                  <polyline fill="none" stroke="var(--wf-warn)" strokeWidth="1.4"
                    points="0,8 50,14 100,22 150,42 200,60 250,80 300,94 350,103 400,110"/>
                  {/* A — winner */}
                  <polyline fill="none" stroke="var(--wf-ok)" strokeWidth="1.6"
                    points="0,5 50,8 100,14 150,28 200,40 250,58 300,72 350,82 400,90"/>
                </svg>
                <div style={{ position:"absolute", top:8, right:10, display:"flex", gap:10, fontFamily:"var(--wf-font-mono)", fontSize:10.5 }}>
                  <span style={{color:"var(--wf-ok)"}}>● A (winner)</span>
                  <span style={{color:"var(--wf-warn)"}}>● B</span>
                  <span style={{color:"var(--wf-text-3)"}}>· baseline</span>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT — best patterns + per-main rollup */}
          <div style={{
            borderLeft:"1px dashed var(--wf-line)",
            padding:"14px 18px", overflow:"hidden",
            display:"flex", flexDirection:"column", gap:12
          }}>
            <div className="box">
              <div className="h-row">
                <span className="lbl-h">Best-performing variant patterns · 30d</span>
              </div>
              {[
                { p:"Close-up → wide reveal",     v:"+62% avg", k:"winner",   n:"won 4 of 6 batches" },
                { p:"Captions cold-open",         v:"+38% avg", k:"winner",   n:"won 3 of 6" },
                { p:"Drone push-in",              v:"+8% avg",  k:"",         n:"break-even" },
                { p:"Vertical pano",              v:"+24% avg", k:"",         n:"3 batches" },
                { p:"Slow-mo entry",              v:"−18% avg", k:"loser",    n:"retire" },
              ].map((p, i) => (
                <div key={i} className={"bar-row " + (p.k==="winner"?"winner":p.k==="loser"?"loser":"baseline")}>
                  <span className="lab">{p.p}</span>
                  <span className="bar"><i style={{ width: p.k==="loser" ? "22%" : (p.k==="winner" ? "78%" : "44%") }}></i></span>
                  <span className="val" style={{ color: p.k==="winner"?"var(--wf-ok)":p.k==="loser"?"var(--wf-bad)":"var(--wf-text)" }}>{p.v}</span>
                </div>
              ))}
              <div className="hr"></div>
              <div className="lbl" style={{marginBottom:6}}>NOTES</div>
              <div style={{ fontSize:11.5, color:"var(--wf-text-2)", lineHeight:1.4 }}>
                Slow-mo entries underperform baseline on every metric. Recommend dropping from variant set or using only for retention salvage.
              </div>
            </div>

            <div className="box">
              <div className="h-row">
                <span className="lbl-h">Top main reels · 30d</span>
                <Pill>by score</Pill>
              </div>
              {[
                { id:"REEL-149", t:"Market color burst", v:"411k", k:"winner" },
                { id:"REEL-152", t:"Boudha sunset",      v:"138k", k:"" },
                { id:"REEL-145", t:"Annapurna teaser",   v:"96k",  k:"" },
                { id:"REEL-138", t:"Patan window light", v:"54k",  k:"" },
                { id:"REEL-151", t:"Mountain pass cross",v:"42k",  k:"loser", n:"low ret" },
              ].map((r, i) => (
                <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"6px 0",
                  borderBottom: i<4 ? "1px dashed var(--wf-line)" : "none"
                }}>
                  <span style={{fontFamily:"var(--wf-font-mono)", fontSize:9.5, color:"var(--wf-text-3)"}}>{r.id}</span>
                  <span style={{flex:1, fontSize:12, color:"var(--wf-text)"}}>{r.t}</span>
                  <span style={{fontFamily:"var(--wf-font-mono)", fontSize:11.5,
                    color: r.k==="winner"?"var(--wf-ok)":r.k==="loser"?"var(--wf-bad)":"var(--wf-text-2)"
                  }}>{r.v}</span>
                </div>
              ))}
            </div>

            <div className="box">
              <div className="h-row">
                <span className="lbl-h">Operational signal</span>
                <Pill>auto</Pill>
              </div>
              <div className="note" style={{ fontSize:13 }}>
                "close-up → wide reveal" is now the most reliable variant pattern.<br/>
                Make it variant A by default for the next 5 batches.
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
          <span>Analytics · variant A/B/C/D/E table is the spine · baseline always visible</span>
          <span className="anno">winners promote to templates · losers retire</span>
        </div>
      </div>
    </div>
  </div>
);

window.AnalyticsWF = AnalyticsWF;
