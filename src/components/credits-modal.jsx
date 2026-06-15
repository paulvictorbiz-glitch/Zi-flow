/* =========================================================
   CreditsModal — "Get Credits" payment UI (mockup only; no real
   payment platform connected). Credit-pack tiers + a non-functional
   card-details form with a disabled Pay button.

   Props:
     open      — bool
     onClose() — close handler
   ========================================================= */
import React, { useEffect, useState } from "react";
import "./credits-modal.css";

const PACKS = [
  { id: "starter", credits: 50,  price: 9,  per: "$0.18", tag: "" },
  { id: "creator", credits: 200, price: 29, per: "$0.15", tag: "Most popular" },
  { id: "studio",  credits: 500, price: 59, per: "$0.12", tag: "Best value" },
];

export function CreditsModal({ open, onClose }) {
  const [selected, setSelected] = useState("creator");

  // Close on Escape; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const pack = PACKS.find((p) => p.id === selected) || PACKS[0];

  return (
    <div className="cm-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cm-modal" role="dialog" aria-modal="true" aria-label="Get credits">
        <button className="cm-close" onClick={onClose} aria-label="Close">×</button>

        <header className="cm-head">
          <p className="cm-eyebrow">Get credits</p>
          <h3 className="cm-title">Top up your Reel DNA credits</h3>
          <p className="cm-sub">1 credit = 1 reel deconstruction or one content pack.</p>
        </header>

        {/* Packs */}
        <div className="cm-packs">
          {PACKS.map((p) => (
            <button
              key={p.id}
              className={"cm-pack" + (selected === p.id ? " is-selected" : "")}
              onClick={() => setSelected(p.id)}
            >
              {p.tag && <span className="cm-pack-tag">{p.tag}</span>}
              <span className="cm-pack-credits">{p.credits}</span>
              <span className="cm-pack-credits-label">credits</span>
              <span className="cm-pack-price">${p.price}</span>
              <span className="cm-pack-per">{p.per} / credit</span>
            </button>
          ))}
        </div>

        {/* Card form (mock) */}
        <div className="cm-form">
          <div className="cm-form-row">
            <label className="cm-fld cm-fld--full">
              <span className="cm-fld-label">Card number</span>
              <input className="cm-fld-input" inputMode="numeric" placeholder="1234 5678 9012 3456" />
            </label>
          </div>
          <div className="cm-form-row">
            <label className="cm-fld">
              <span className="cm-fld-label">Expiry</span>
              <input className="cm-fld-input" placeholder="MM / YY" />
            </label>
            <label className="cm-fld">
              <span className="cm-fld-label">CVC</span>
              <input className="cm-fld-input" inputMode="numeric" placeholder="123" />
            </label>
            <label className="cm-fld">
              <span className="cm-fld-label">ZIP</span>
              <input className="cm-fld-input" inputMode="numeric" placeholder="00000" />
            </label>
          </div>
        </div>

        <button className="cm-pay" disabled title="Payments coming soon">
          Pay ${pack.price} · {pack.credits} credits
        </button>
        <p className="cm-note">
          🔒 Payments aren't live yet — this is a preview of checkout. No card will be charged.
        </p>
      </div>
    </div>
  );
}

export default CreditsModal;
