/* =========================================================
   GamifyWelcomePopup — the daily game-loop modal.

   Shows once per 24h per person on the first load of the day, when
   gamify is enabled. Left: the player's skill spider chart. Right:
   the EXP bar (current level large, next 2 levels listed), the medal
   silhouette with its progress, and the next reward to unlock.

   Mounted always in app.jsx; it gates its own visibility on:
     · gamifyEnabled (owner toggle)
     · a once-per-24h localStorage stamp per person
   ========================================================= */

import React from "react";
import { useAuth } from "../auth.jsx";
import { useWorkflow } from "../store/store.jsx";
import SpiderChart from "./SpiderChart.jsx";
import {
  levelForXp, medalProgress, MEDAL_TIERS, REWARDS,
} from "../lib/gamify-data.jsx";
import MedalBadge from "./MedalBadge.jsx";
import "./gamify.css";

const DAY_MS = 24 * 60 * 60 * 1000;

export default function GamifyWelcomePopup() {
  const { person } = useAuth();
  const { gamifyEnabled, gamifyProgress } = useWorkflow();
  const [open, setOpen] = React.useState(false);

  const personId = person?.id;

  React.useEffect(() => {
    if (!gamifyEnabled || !personId) return;
    let last = 0;
    try { last = Number(localStorage.getItem("gamify_last_seen_" + personId) || 0); } catch (_) {}
    if (Date.now() - last >= DAY_MS) {
      setOpen(true);
    }
  }, [gamifyEnabled, personId]);

  if (!open || !gamifyEnabled) return null;

  const progress = gamifyProgress.find(p => p.personId === personId);
  const scores = progress?.skillScores || {};
  const totalXp = progress?.totalXp || 0;
  const { current, next, nextNext, progress: bandPct } = levelForXp(totalXp);
  const { current: curMedal, target: medalTarget, progress: medalPct } = medalProgress(scores);

  const unlocked = new Set(progress?.unlockedRewards || []);
  const nextReward = REWARDS.find(r => !unlocked.has(r.id));

  const dismiss = () => {
    try { localStorage.setItem("gamify_last_seen_" + personId, String(Date.now())); } catch (_) {}
    setOpen(false);
  };

  return (
    <div className="gf-overlay" onClick={dismiss}>
      <div className="gf-popup" onClick={(e) => e.stopPropagation()}>
        <button className="gf-close" onClick={dismiss} aria-label="Close">✕</button>

        <div className="gf-popup-head">
          <span className="gf-popup-kicker">🎮 Daily Progress</span>
          <h2 className="gf-popup-title">
            Welcome back, {person?.name || "editor"}
          </h2>
        </div>

        <div className="gf-popup-body">
          {/* Left — spider chart */}
          <div className="gf-popup-chart">
            <SpiderChart scores={scores} size={300} labelMode="short" />
            <div className="gf-chart-caption">Your skill roundedness</div>
          </div>

          {/* Right — EXP, medal, reward */}
          <div className="gf-popup-side">
            {/* Level + EXP bar */}
            <div className="gf-level-block">
              <div className="gf-level-now">
                <span className="gf-level-num">LV {current.level}</span>
                <span className="gf-level-title">{current.title}</span>
              </div>
              <div className="gf-xpbar">
                <div className="gf-xpbar-fill" style={{ width: `${Math.round(bandPct * 100)}%` }} />
              </div>
              <div className="gf-xp-meta">
                <span>{totalXp.toLocaleString()} XP</span>
                {next && <span>{next.xp.toLocaleString()} XP → LV {next.level}</span>}
              </div>
              <div className="gf-next-levels">
                {next && <div className="gf-next-row"><span>LV {next.level}</span><span>{next.title}</span></div>}
                {nextNext && <div className="gf-next-row dim"><span>LV {nextNext.level}</span><span>{nextNext.title}</span></div>}
              </div>
            </div>

            {/* Medal */}
            <div className="gf-medal-block">
              <MedalBadge medal={curMedal} progress={medalPct} size={64} />
              <div className="gf-medal-info">
                <div className="gf-medal-title">
                  {curMedal === "none"
                    ? "No medal yet"
                    : MEDAL_TIERS.find(t => t.id === curMedal)?.title}
                </div>
                <div className="gf-medal-next dim">
                  {Math.round(medalPct * 100)}% toward {medalTarget.title}
                </div>
              </div>
            </div>

            {/* Next reward */}
            {nextReward && (
              <div className="gf-reward-box">
                <div className="gf-reward-lock">🔒</div>
                <div>
                  <div className="gf-reward-label">{nextReward.label}</div>
                  <div className="gf-reward-blurb dim">{nextReward.blurb}</div>
                  <div className="gf-reward-at">Unlocks at LV {nextReward.level}</div>
                </div>
              </div>
            )}
          </div>
        </div>

        <button className="gf-cta" onClick={dismiss}>Start editing →</button>
      </div>
    </div>
  );
}
