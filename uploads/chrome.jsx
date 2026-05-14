// Shared chrome (sidebar + topbar + page header) used by every wireframe.
// Exposed on window for cross-script use.

const WFNav = ({ active }) => {
  const groups = [
    { label: "WORKSPACE", items: [
      { id: "dashboard", name: "Dashboard", badge: null },
      { id: "pipeline", name: "Pipeline", badge: "12" },
      { id: "my-work", name: "My Work", badge: "5" },
    ]},
    { label: "PRODUCTION", items: [
      { id: "idea-pool", name: "Idea Pool", badge: "23" },
      { id: "discovery", name: "Discovery Queue", badge: "04", discovery: true },
      { id: "main-edits", name: "Main Edits", badge: "03" },
      { id: "approvals", name: "Awaiting Approval", badge: "02", alert: true },
      { id: "variants", name: "Variant Batches", badge: "06" },
      { id: "ready", name: "Ready to Post", badge: "09" },
    ]},
    { label: "FEEDBACK", items: [
      { id: "analytics", name: "Analytics", badge: null },
      { id: "posted", name: "Posted Reels", badge: "147" },
    ]},
    { label: "WORKSPACE", items: [
      { id: "team", name: "Team & Roles", badge: null },
      { id: "settings", name: "Settings", badge: null },
    ]},
  ];
  return (
    <aside className="wf-side">
      {groups.map((g, gi) => (
        <div className="wf-side-group" key={gi}>
          <div className="wf-side-label">{g.label}</div>
          {g.items.map((it) => (
            <div
              key={it.id}
              className={"wf-nav" + (active === it.id ? " active" : "")}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                {it.alert ? <span className="dot"></span> : null}
                {it.discovery
                  ? <span style={{ color: "var(--wf-discovery)" }}>◇</span>
                  : null}
                {it.name}
              </span>
              {it.badge ? <span className="badge">{it.badge}</span> : null}
            </div>
          ))}
        </div>
      ))}
    </aside>
  );
};

const WFTopbar = ({ crumb }) => (
  <header className="wf-topbar">
    <div className="wf-logo">Content Ops OS</div>
    <div className="crumb">/ {crumb}</div>
    <div className="spacer"></div>
    <div className="wf-search">⌕ &nbsp;search reels, ideas, footage… &nbsp;<span style={{color:"var(--wf-text-3)"}}>⌘K</span></div>
    <div className="wf-iconbtn">⤓</div>
    <div className="wf-iconbtn" style={{position:"relative"}}>
      ◔
      <span style={{
        position:"absolute", top:-3, right:-3,
        width:7, height:7, borderRadius:"50%", background:"var(--wf-bad)"
      }}></span>
    </div>
    <div className="wf-avatar">PV</div>
  </header>
);

const WFPageHeader = ({ title, subtitle, actions }) => (
  <div className="wf-pageheader">
    <div>
      <h1>{title}</h1>
      {subtitle ? <div className="sub">{subtitle}</div> : null}
    </div>
    <div className="wf-actions">{actions}</div>
  </div>
);

// time pill component
const T = ({ kind = "ok", children }) => (
  <span className={"t-pill " + kind}>{children}</span>
);
const Pill = ({ children, variant, style }) => (
  <span className={"pill " + (variant || "")} style={style}>{children}</span>
);

// reusable reel card on a pipeline column
const ReelCard = ({
  id, title, concept, owner, due, time, timeKind = "ok",
  state = "ok", blocker, deps, variants, attached, age, role
}) => (
  <div className={"reel-card s-" + state}>
    <span className="lside"></span>
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
      <span className="id">{id}</span>
      {role ? <Pill>{role}</Pill> : null}
    </div>
    <div className="title">{title}</div>
    {concept ? <div className="concept">{concept}</div> : null}
    {blocker ? <div className="blocker-note">{blocker}</div> : null}
    <div className="meta">
      {owner ? (
        <span style={{ display:"inline-flex", alignItems:"center", gap:5 }}>
          <span className="av">{owner.split(" ").map(s=>s[0]).join("").slice(0,2)}</span>
          <span style={{ fontFamily:"var(--wf-font-mono)", fontSize:10.5, color:"var(--wf-text-2)" }}>
            {owner.split(" ")[0]}
          </span>
        </span>
      ) : null}
      <span className="grow"></span>
      {time ? <T kind={timeKind}>{time}</T> : null}
    </div>
    {(variants || attached || age) ? (
      <div className="meta" style={{ borderTop:"1px dashed var(--wf-line)", paddingTop:6, gap:8 }}>
        {variants ? <span style={{fontFamily:"var(--wf-font-mono)", fontSize:10, color:"var(--wf-text-3)"}}>◫ {variants}</span> : null}
        {attached ? <span style={{fontFamily:"var(--wf-font-mono)", fontSize:10, color:"var(--wf-text-3)"}}>⌘ {attached}</span> : null}
        <span className="grow"></span>
        {age ? <span style={{fontFamily:"var(--wf-font-mono)", fontSize:10, color:"var(--wf-text-3)"}}>{age}</span> : null}
      </div>
    ) : null}
    {deps ? <div style={{fontFamily:"var(--wf-font-mono)", fontSize:10, color:"var(--wf-text-3)", borderTop:"1px dashed var(--wf-line)", paddingTop:6}}>
      → {deps}
    </div> : null}
  </div>
);

Object.assign(window, { WFNav, WFTopbar, WFPageHeader, T, Pill, ReelCard });
