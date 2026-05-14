/* =========================================================
   WorkflowStore — single source of truth for reels + tasks +
   reviewer-lane shadow cards, backed by Supabase.

   The provider:
     · hydrates state with one parallel fetch on mount,
     · dispatches reducer actions for local (optimistic) updates,
     · persists each mutation back to Supabase in the background.

   App state stays in camelCase (`blockerRole`, `variantProgress`,
   etc.) for ergonomics; DB columns are snake_case. The mapping
   helpers at the top of this file convert at the IO boundary so
   no consumer has to know about the DB shape.

   Escape hatches:
     · __resetWorkflow()  — clears the legacy localStorage cache
       and reloads the page (which re-fetches from Supabase).
     · `npm run seed`     — resets DB rows to today's static seed.
   ========================================================= */

import React from "react";
import { PEOPLE, ROLES, normalizeStage, STAGE_ROLE, stageOwnerPersonId } from "./shared-data.jsx";
import { supabase } from "./supabase-client.js";

/* ---------- camelCase ↔ snake_case mappers ---------- */
function reelFromDb(row) {
  if (!row) return row;
  const { blocker_role, prev_owner, variant_progress, fb_query,
          attach_url, due_at, stage_entered_at, archived_at,
          created_at, updated_at, stage, ...rest } = row;
  return {
    ...rest,
    stage: normalizeStage(stage),
    blockerRole: blocker_role ?? undefined,
    prevOwner: prev_owner ?? undefined,
    variantProgress: variant_progress ?? undefined,
    fbQuery: fb_query ?? undefined,
    attachUrl: attach_url ?? undefined,
    dueAt: due_at ?? undefined,
    stageEnteredAt: stage_entered_at ?? undefined,
    archivedAt: archived_at ?? undefined,
  };
}
function reelToDb(reel) {
  // Only includes fields that exist in public.reels — anything
  // foreign (e.g. ephemeral _idx) is dropped.
  const { blockerRole, prevOwner, variantProgress, fbQuery, attachUrl,
          dueAt, stageEnteredAt,
          lane, owner, stage, state, age, due, fb, refs,
          blocker, next, downstream, grouping, note, foot,
          tone, links, status, logline, script, vo, audio, inspo, plan,
          detail, title, id } = reel;
  const out = { id, title, stage, owner, lane, state, age, due,
    fb, refs, blocker, next, downstream, grouping, note, foot,
    tone, links, status, logline, script, vo, audio, inspo, plan, detail,
    blocker_role: blockerRole ?? null,
    prev_owner: prevOwner ?? null,
    variant_progress: variantProgress ?? null,
    fb_query: fbQuery ?? null,
    attach_url: attachUrl ?? null,
    due_at: dueAt ?? null,
    stage_entered_at: stageEnteredAt ?? null };
  return out;
}
function cardFromDb(row) {
  if (!row) return row;
  const { parent_id, created_at, updated_at, stage, ...rest } = row;
  return { ...rest, stage: normalizeStage(stage), parentId: parent_id ?? undefined };
}
function cardToDb(card) {
  const { parentId, id, title, stage, lane, owner, state, note,
          foot, tone, status } = card;
  return { id, title, stage, lane, owner, state, note, foot,
    tone, status, parent_id: parentId ?? null };
}
function taskFromDb(row) {
  if (!row) return row;
  const { from_person, to_person, reel_id, due_at, created_at, updated_at, ...rest } = row;
  return { ...rest, from: from_person, to: to_person, reel: reel_id, dueAt: due_at ?? undefined };
}
function taskToDb(task) {
  const { from, to, reel, dueAt, id, type, instruction, due, state, ref } = task;
  return { id, type, instruction, due, state, ref,
    from_person: from ?? null, to_person: to ?? null,
    reel_id: reel ?? null,
    due_at: dueAt ?? null };
}

/* Build the next revisionHistory array. Folds the older single-field
   shape (`revisionNote` / `revisionAt` / `revisionBy`) into the head
   of the array on first append so nothing is lost on migration. */
function appendRevisionEntry(detail, entry) {
  const existing = Array.isArray(detail?.revisionHistory) ? detail.revisionHistory : [];
  const legacy = !existing.length && detail?.revisionNote
    ? [{ action: "sent_back", ts: detail.revisionAt || null,
         by: detail.revisionBy || null, note: detail.revisionNote }]
    : [];
  return [...legacy, ...existing, entry];
}

/* Build a system-authored comment entry. Used on stage transitions
   so the timeline has a paper trail of who got the handoff and
   when. Renders with `system: true` so the UI can style it
   differently from a human comment. */
function buildSystemComment(txt) {
  return {
    id: "c-sys-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
    authorId: null,
    who: "Workflow",
    role: "system",
    ts: new Date().toISOString(),
    txt,
    system: true,
  };
}
function appendComment(detail, entry) {
  const existing = Array.isArray(detail?.comments) ? detail.comments : [];
  return [...existing, entry];
}

/* ---------- Reducer (pure, identical semantics to before) ---------- */
function workflowReducer(state, action) {
  switch (action.type) {

    case "HYDRATE":
      return { ...state, ...action.payload, loaded: true, error: null };

    case "SET_ERROR":
      return { ...state, error: action.error };

    case "MOVE_STAGE": {
      const stamp = action.stageEnteredAt || new Date().toISOString();
      const apply = (r) => {
        if (r.id !== action.id) return r;
        const stageChanged = action.stage !== r.stage;
        const next = { ...r, stage: action.stage };
        if (stageChanged) next.stageEnteredAt = stamp;
        if (action.stage === "review" && r.stage !== "review") {
          next.prevOwner = r.owner;
        }

        /* Lane vs. stage-role precedence for the owner field:
           - If the user dragged into a different person's row, the
             lane drop is an explicit reassign — honour it.
           - Otherwise (same lane, just a column change), fall back
             to the stage-canonical owner so the handoff is
             automatic: in_progress→skilled, review→reviewer,
             completed→variant, etc. See STAGE_ROLE in shared-data. */
        const explicitLaneReassign =
          action.lane !== undefined &&
          action.lane !== "review" &&
          PEOPLE[action.lane] &&
          action.lane !== r.owner;

        if (action.lane !== undefined) next.lane = action.lane;

        if (explicitLaneReassign) {
          next.owner = action.lane;
        } else if (stageChanged) {
          const stagePerson = stageOwnerPersonId(action.stage);
          if (stagePerson && stagePerson !== r.owner) {
            next.owner = stagePerson;
            // Keep lane in lockstep with owner so the card lands in
            // the right row visually after the auto-reassign.
            if (action.lane === undefined || action.lane === r.owner) {
              next.lane = stagePerson;
            }
          }
        }

        /* On a real stage change, append the prebuilt system
           comment (passed through on `action.systemComment`) for
           the audit trail. Same entry is sent to the DB by
           persistMoveStage so optimistic + echoed states match. */
        if (stageChanged && !r.parentId && action.systemComment) {
          next.detail = {
            ...(r.detail || {}),
            comments: appendComment(r.detail, action.systemComment),
          };
        }
        return next;
      };
      return {
        ...state,
        reels: state.reels.map(apply),
        reviewLaneCards: state.reviewLaneCards.map(apply),
      };
    }

    case "UPDATE_REEL": {
      const apply = (r) => r.id === action.id ? { ...r, ...action.patch } : r;
      return {
        ...state,
        reels: state.reels.map(apply),
        reviewLaneCards: state.reviewLaneCards.map(apply),
      };
    }

    case "CREATE_REEL":
      return { ...state, reels: [action.reel, ...state.reels] };

    case "DELETE_REEL":
      return {
        ...state,
        reels: state.reels.filter(r => r.id !== action.id),
        reviewLaneCards: state.reviewLaneCards.filter(r =>
          r.id !== action.id && r.parentId !== action.id),
      };

    case "CREATE_TASK":
      return { ...state, tasks: [action.task, ...state.tasks] };

    case "UPDATE_TASK": {
      const apply = (t) => t.id === action.id ? { ...t, ...action.patch } : t;
      return { ...state, tasks: state.tasks.map(apply) };
    }

    case "DELETE_TASK":
      return { ...state, tasks: state.tasks.filter(t => t.id !== action.id) };

    /* Realtime cases — fired by Supabase Postgres-changes echoes.
       UPSERT_* replaces an existing row by id or prepends if new.
       DELETE_*_BY_ID is idempotent on already-removed rows. */
    case "UPSERT_REEL": {
      const exists = state.reels.some(r => r.id === action.reel.id);
      return {
        ...state,
        reels: exists
          ? state.reels.map(r => r.id === action.reel.id ? action.reel : r)
          : [action.reel, ...state.reels],
      };
    }
    case "DELETE_REEL_BY_ID":
      return {
        ...state,
        reels: state.reels.filter(r => r.id !== action.id),
        reviewLaneCards: state.reviewLaneCards.filter(c =>
          c.id !== action.id && c.parentId !== action.id),
      };

    case "UPSERT_CARD": {
      const exists = state.reviewLaneCards.some(c => c.id === action.card.id);
      return {
        ...state,
        reviewLaneCards: exists
          ? state.reviewLaneCards.map(c => c.id === action.card.id ? action.card : c)
          : [action.card, ...state.reviewLaneCards],
      };
    }
    case "DELETE_CARD_BY_ID":
      return { ...state, reviewLaneCards: state.reviewLaneCards.filter(c => c.id !== action.id) };

    case "UPSERT_TASK": {
      const exists = state.tasks.some(t => t.id === action.task.id);
      return {
        ...state,
        tasks: exists
          ? state.tasks.map(t => t.id === action.task.id ? action.task : t)
          : [action.task, ...state.tasks],
      };
    }
    case "DELETE_TASK_BY_ID":
      return { ...state, tasks: state.tasks.filter(t => t.id !== action.id) };

    case "ADD_ATTACHED_FOOTAGE":
      return { ...state, attachedFootage: [action.item, ...state.attachedFootage] };

    case "REMOVE_ATTACHED_FOOTAGE":
      return { ...state, attachedFootage: state.attachedFootage.filter(f => f.id !== action.id) };

    case "UPSERT_ATTACHED_FOOTAGE": {
      const exists = state.attachedFootage.some(f => f.id === action.item.id);
      return {
        ...state,
        attachedFootage: exists
          ? state.attachedFootage.map(f => f.id === action.item.id ? action.item : f)
          : [action.item, ...state.attachedFootage],
      };
    }

    case "DELETE_ATTACHED_FOOTAGE_BY_ID":
      return { ...state, attachedFootage: state.attachedFootage.filter(f => f.id !== action.id) };

    case "APPROVE_REVIEW": {
      const stamp = action.stageEnteredAt || new Date().toISOString();
      return {
        ...state,
        reels: state.reels.map(r => {
          if (r.id !== action.id) return r;
          const history = appendRevisionEntry(r.detail, {
            action: "approved", ts: stamp, by: action.by || null, note: "",
          });
          return { ...r,
            stage: "completed", state: "ok",
            blocker: null, blockerRole: null,
            age: "approved",
            stageEnteredAt: stamp,
            next: "Hold for post window",
            detail: { ...(r.detail || {}), revisionHistory: history } };
        }),
      };
    }

    case "SEND_BACK": {
      const editor = ROLES.skilled?.person;
      const stamp = action.stageEnteredAt || new Date().toISOString();
      return {
        ...state,
        reels: state.reels.map(r => {
          if (r.id !== action.id) return r;
          const target = r.prevOwner || editor || r.owner;
          const note = (action.note || "").trim();
          const history = appendRevisionEntry(r.detail, {
            action: "sent_back", ts: stamp, by: action.by || null, note,
          });
          return { ...r,
            stage: "in_progress", state: "warn",
            owner: target, lane: target,
            blocker: note ? "For revision · " + note.slice(0, 60) : "Sent back for revision",
            blockerRole: "skilled",
            age: "just now",
            stageEnteredAt: stamp,
            next: "Address review notes",
            // Append to revisionHistory so Paul/Leroy can see every
            // prior round of notes when the reel comes back for review.
            detail: { ...(r.detail || {}), revisionHistory: history } };
        }),
      };
    }

    case "TRIAGE_IDEA": {
      if (action.decision === "kill") {
        return { ...state, reels: state.reels.filter(r => r.id !== action.id) };
      }
      const stamp = action.stageEnteredAt || new Date().toISOString();
      return {
        ...state,
        reels: state.reels.map(r => {
          if (r.id !== action.id) return r;
          if (action.decision === "greenlight") {
            return { ...r, stage: "not_started", state: "ok", blocker: null,
                     age: "queued", stageEnteredAt: stamp,
                     next: "Start main edit" };
          }
          if (action.decision === "defer") {
            return { ...r, state: "warn", age: "deferred",
                     next: "Revisit next cycle" };
          }
          return r;
        }),
      };
    }

    default:
      return state;
  }
}

/* ---------- Supabase persistence (called after each dispatch) ----------
   Optimistic pattern: the dispatch already updated local state.
   Here we mirror the same change to Supabase. On error we log
   and surface via SET_ERROR; no automatic rollback for the
   prototype. */

async function persistMoveStage(state, id, { lane, stage, systemComment }) {
  const isCard = state.reviewLaneCards.some(c => c.id === id);
  const table = isCard ? "review_lane_cards" : "reels";
  const reel = (isCard ? state.reviewLaneCards : state.reels).find(r => r.id === id);
  if (!reel) return;
  const stageChanged = reel.stage !== stage;
  const patch = { stage };

  /* Mirror the reducer's lane-vs-stage-role precedence so the DB
     row matches the optimistic local update. */
  const explicitLaneReassign =
    !isCard &&
    lane !== undefined &&
    lane !== "review" &&
    PEOPLE[lane] &&
    lane !== reel.owner;

  if (lane !== undefined) patch.lane = lane;

  if (explicitLaneReassign) {
    patch.owner = lane;
  } else if (!isCard && stageChanged) {
    const stagePerson = stageOwnerPersonId(stage);
    if (stagePerson && stagePerson !== reel.owner) {
      patch.owner = stagePerson;
      if (lane === undefined || lane === reel.owner) {
        patch.lane = stagePerson;
      }
    }
  }

  if (stage === "review" && reel.stage !== "review" && !isCard) {
    patch.prev_owner = reel.owner;
  }
  if (!isCard && stageChanged) {
    patch.stage_entered_at = new Date().toISOString();
    if (systemComment) {
      // Reuse the exact same entry built by the action creator so
      // the optimistic + realtime-echoed row carry identical ids.
      patch.detail = {
        ...(reel.detail || {}),
        comments: appendComment(reel.detail, systemComment),
      };
    }
  }
  const { error } = await supabase.from(table).update(patch).eq("id", id);
  if (error) throw error;
}

async function persistUpdateReel(state, id, patch) {
  const isCard = state.reviewLaneCards.some(c => c.id === id);
  const table = isCard ? "review_lane_cards" : "reels";
  // Remap camelCase patch keys to snake_case where applicable
  const dbPatch = { ...patch };
  if ("blockerRole" in patch) { dbPatch.blocker_role = patch.blockerRole; delete dbPatch.blockerRole; }
  if ("prevOwner" in patch)   { dbPatch.prev_owner = patch.prevOwner; delete dbPatch.prevOwner; }
  if ("variantProgress" in patch) { dbPatch.variant_progress = patch.variantProgress; delete dbPatch.variantProgress; }
  if ("fbQuery" in patch)     { dbPatch.fb_query = patch.fbQuery; delete dbPatch.fbQuery; }
  if ("attachUrl" in patch)   { dbPatch.attach_url = patch.attachUrl; delete dbPatch.attachUrl; }
  if ("dueAt" in patch)       { dbPatch.due_at = patch.dueAt; delete dbPatch.dueAt; }
  if ("stageEnteredAt" in patch) { dbPatch.stage_entered_at = patch.stageEnteredAt; delete dbPatch.stageEnteredAt; }
  if ("archivedAt" in patch)  { dbPatch.archived_at = patch.archivedAt; delete dbPatch.archivedAt; }
  if ("parentId" in patch)    { dbPatch.parent_id = patch.parentId; delete dbPatch.parentId; }
  const { error } = await supabase.from(table).update(dbPatch).eq("id", id);
  if (error) throw error;
}

async function persistCreateReel(reel) {
  const { error } = await supabase.from("reels").insert(reelToDb(reel));
  if (error) throw error;
}

async function persistDeleteReel(id) {
  // review_lane_cards rows with this as parent_id cascade via FK
  const { error } = await supabase.from("reels").delete().eq("id", id);
  if (error) throw error;
}

async function persistCreateTask(task) {
  const { error } = await supabase.from("tasks").insert(taskToDb(task));
  if (error) throw error;
}

async function persistUpdateTask(id, patch) {
  const dbPatch = { ...patch };
  if ("from" in patch) { dbPatch.from_person = patch.from; delete dbPatch.from; }
  if ("to" in patch)   { dbPatch.to_person = patch.to; delete dbPatch.to; }
  if ("reel" in patch) { dbPatch.reel_id = patch.reel; delete dbPatch.reel; }
  const { error } = await supabase.from("tasks").update(dbPatch).eq("id", id);
  if (error) throw error;
}

async function persistDeleteTask(id) {
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) throw error;
}

async function persistAddAttachedFootage(item) {
  const { error } = await supabase.from("attached_footage_items").insert(item);
  if (error) throw error;
}

async function persistRemoveAttachedFootage(id) {
  const { error } = await supabase.from("attached_footage_items").delete().eq("id", id);
  if (error) throw error;
}

/* ---------- Context + provider ---------- */
const WorkflowContext = React.createContext(null);

const INITIAL_STATE = {
  reels: [],
  reviewLaneCards: [],
  tasks: [],
  attachedFootage: [],
  loaded: false,
  error: null,
};

function WorkflowProvider({ children }) {
  const [state, dispatch] = React.useReducer(workflowReducer, INITIAL_STATE);

  // One-time legacy cleanup — old step 1.5 / step 2 caches.
  React.useEffect(() => {
    try {
      localStorage.removeItem("workflow.board.items.v1");
      localStorage.removeItem("workflow.store.v1");
    } catch (_) {}
  }, []);

  // Hydrate from Supabase on mount.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [reelsRes, cardsRes, tasksRes, footageRes] = await Promise.all([
          supabase.from("reels").select("*"),
          supabase.from("review_lane_cards").select("*"),
          supabase.from("tasks").select("*"),
          supabase.from("attached_footage_items").select("*"),
        ]);
        if (reelsRes.error) throw reelsRes.error;
        if (cardsRes.error) throw cardsRes.error;
        if (tasksRes.error) throw tasksRes.error;
        if (footageRes.error) throw footageRes.error;
        if (cancelled) return;
        dispatch({ type: "HYDRATE", payload: {
          reels: (reelsRes.data || []).map(reelFromDb),
          reviewLaneCards: (cardsRes.data || []).map(cardFromDb),
          tasks: (tasksRes.data || []).map(taskFromDb),
          attachedFootage: footageRes.data || [],
        }});
      } catch (e) {
        if (cancelled) return;
        console.error("Hydrate failed:", e);
        dispatch({ type: "SET_ERROR", error: e.message || String(e) });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* Realtime sync — once the initial hydrate completes, open a
     postgres-changes channel for reels / review_lane_cards /
     tasks. Each payload is normalised through the same fromDb()
     mappers used at hydrate, then merged via UPSERT / DELETE_BY_ID
     reducer cases.

     Echoes of this client's own writes arrive too — they are
     idempotent (UPSERT replaces with the same row, DELETE_BY_ID
     is a no-op on already-removed rows), so we don't bother
     filtering them out. */
  React.useEffect(() => {
    if (!state.loaded) return;
    const channel = supabase
      .channel("workflow-realtime")
      .on("postgres_changes",
          { event: "*", schema: "public", table: "reels" },
          (payload) => {
            if (payload.eventType === "DELETE") {
              dispatch({ type: "DELETE_REEL_BY_ID", id: payload.old?.id });
            } else if (payload.new) {
              dispatch({ type: "UPSERT_REEL", reel: reelFromDb(payload.new) });
            }
          })
      .on("postgres_changes",
          { event: "*", schema: "public", table: "review_lane_cards" },
          (payload) => {
            if (payload.eventType === "DELETE") {
              dispatch({ type: "DELETE_CARD_BY_ID", id: payload.old?.id });
            } else if (payload.new) {
              dispatch({ type: "UPSERT_CARD", card: cardFromDb(payload.new) });
            }
          })
      .on("postgres_changes",
          { event: "*", schema: "public", table: "tasks" },
          (payload) => {
            if (payload.eventType === "DELETE") {
              dispatch({ type: "DELETE_TASK_BY_ID", id: payload.old?.id });
            } else if (payload.new) {
              dispatch({ type: "UPSERT_TASK", task: taskFromDb(payload.new) });
            }
          })
      .on("postgres_changes",
          { event: "*", schema: "public", table: "attached_footage_items" },
          (payload) => {
            if (payload.eventType === "DELETE") {
              dispatch({ type: "DELETE_ATTACHED_FOOTAGE_BY_ID", id: payload.old?.id });
            } else if (payload.new) {
              dispatch({ type: "UPSERT_ATTACHED_FOOTAGE", item: payload.new });
            }
          })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [state.loaded]);

  // Helper: dispatch locally, then persist. If persist fails,
  // log and surface — local state stays optimistic.
  const stateRef = React.useRef(state);
  React.useEffect(() => { stateRef.current = state; }, [state]);

  const wrap = React.useCallback((dispatchAction, persistFn) => {
    dispatch(dispatchAction);
    if (persistFn) {
      persistFn(stateRef.current).catch(e => {
        console.error("Persist failed:", e);
        dispatch({ type: "SET_ERROR", error: e.message || String(e) });
      });
    }
  }, []);

  const value = React.useMemo(() => ({
    reels: state.reels,
    reviewLaneCards: state.reviewLaneCards,
    tasks: state.tasks,
    attachedFootage: state.attachedFootage,
    loaded: state.loaded,
    error: state.error,
    dispatch,
    actions: {
      moveStage: (id, { lane, stage }) => {
        /* Pre-build the audit-trail comment once so the optimistic
           reducer state and the persisted DB row use the same
           id/ts (no flicker on realtime echo). */
        const current = stateRef.current;
        const reel = current.reels.find(r => r.id === id) ||
                     current.reviewLaneCards.find(c => c.id === id);
        const isCard = !!reel?.parentId;
        let systemComment = null;
        if (reel && !isCard && reel.stage !== stage) {
          const explicit = lane !== undefined && lane !== "review" &&
                           PEOPLE[lane] && lane !== reel.owner;
          const targetOwner = explicit ? lane :
            (stageOwnerPersonId(stage) || reel.owner);
          const personName = PEOPLE[targetOwner]?.short ||
                             PEOPLE[targetOwner]?.name || targetOwner;
          const txt = "Stage: " + (reel.stage || "—") + " → " + stage +
            (targetOwner ? " · assigned to " + personName : "");
          systemComment = buildSystemComment(txt);
        }
        wrap(
          { type: "MOVE_STAGE", id, lane, stage, systemComment },
          (s) => persistMoveStage(s, id, { lane, stage, systemComment }));
      },

      updateReel: (id, patch) => wrap(
        { type: "UPDATE_REEL", id, patch },
        (s) => persistUpdateReel(s, id, patch)),

      createReel: (reel) => wrap(
        { type: "CREATE_REEL", reel },
        () => persistCreateReel(reel)),

      deleteReel: (id) => wrap(
        { type: "DELETE_REEL", id },
        () => persistDeleteReel(id)),

      /* Soft-archive: sets archived_at to now. Restorable.
         Use deleteReel for hard delete. */
      archiveReel: (id) => {
        const stamp = new Date().toISOString();
        wrap(
          { type: "UPDATE_REEL", id, patch: { archivedAt: stamp } },
          (s) => persistUpdateReel(s, id, { archivedAt: stamp }));
      },
      restoreReel: (id) => wrap(
        { type: "UPDATE_REEL", id, patch: { archivedAt: null } },
        (s) => persistUpdateReel(s, id, { archivedAt: null })),

      createTask: (task) => wrap(
        { type: "CREATE_TASK", task },
        () => persistCreateTask(task)),

      updateTask: (id, patch) => wrap(
        { type: "UPDATE_TASK", id, patch },
        () => persistUpdateTask(id, patch)),

      deleteTask: (id) => wrap(
        { type: "DELETE_TASK", id },
        () => persistDeleteTask(id)),

      addAttachedFootage: (item) => wrap(
        { type: "ADD_ATTACHED_FOOTAGE", item },
        () => persistAddAttachedFootage(item)),

      removeAttachedFootage: (id) => wrap(
        { type: "REMOVE_ATTACHED_FOOTAGE", id },
        () => persistRemoveAttachedFootage(id)),

      // Approve/SendBack/Triage compose existing primitives — they
      // produce a known target shape and a single UPDATE_REEL
      // persist is sufficient.
      approveReview: (id, opts = {}) => {
        const stamp = new Date().toISOString();
        const r = stateRef.current.reels.find(x => x.id === id);
        const by = opts.by || null;
        const history = appendRevisionEntry(r?.detail, {
          action: "approved", ts: stamp, by, note: "",
        });
        dispatch({ type: "APPROVE_REVIEW", id, stageEnteredAt: stamp, by });
        persistUpdateReel(stateRef.current, id, {
          stage: "completed", state: "ok", blocker: null,
          blockerRole: null, age: "approved",
          stageEnteredAt: stamp,
          next: "Hold for post window",
          detail: { ...(r?.detail || {}), revisionHistory: history },
        }).catch(e => {
          console.error(e);
          dispatch({ type: "SET_ERROR", error: e.message || String(e) });
        });
      },

      /* sendBack(id, { note?: string, by?: string })
         Routes the reel back to in_progress with the reviewer's note
         appended to detail.revisionHistory. The full history is
         preserved across review rounds so Paul/Leroy can see prior
         feedback when the reel comes back for re-review. */
      sendBack: (id, opts = {}) => {
        const r = stateRef.current.reels.find(x => x.id === id);
        const editor = ROLES.skilled?.person;
        const target = r?.prevOwner || editor || r?.owner;
        const stamp = new Date().toISOString();
        const note  = (opts.note || "").trim();
        const by    = opts.by || null;
        const history = appendRevisionEntry(r?.detail, {
          action: "sent_back", ts: stamp, by, note,
        });
        dispatch({ type: "SEND_BACK", id, stageEnteredAt: stamp, note, by });
        persistUpdateReel(stateRef.current, id, {
          stage: "in_progress", state: "warn",
          owner: target, lane: target,
          blocker: note ? "For revision · " + note.slice(0, 60) : "Sent back for revision",
          blockerRole: "skilled",
          age: "just now",
          stageEnteredAt: stamp,
          next: "Address review notes",
          detail: { ...(r?.detail || {}), revisionHistory: history },
        }).catch(e => {
          console.error(e);
          dispatch({ type: "SET_ERROR", error: e.message || String(e) });
        });
      },

      triageIdea: (id, decision) => {
        const stamp = new Date().toISOString();
        dispatch({ type: "TRIAGE_IDEA", id, decision, stageEnteredAt: stamp });
        if (decision === "kill") {
          persistDeleteReel(id).catch(e => console.error(e));
        } else if (decision === "greenlight") {
          persistUpdateReel(stateRef.current, id, {
            stage: "selected", state: "ok", blocker: null,
            age: "queued", stageEnteredAt: stamp,
            next: "Start main edit",
          }).catch(e => console.error(e));
        } else if (decision === "defer") {
          persistUpdateReel(stateRef.current, id, {
            state: "warn", age: "deferred",
            next: "Revisit next cycle",
          }).catch(e => console.error(e));
        }
      },
    },
  }), [state, wrap]);

  return (
    <WorkflowContext.Provider value={value}>
      {state.loaded
        ? children
        : <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: "100vh", color: "var(--fg-mute)", fontFamily: "var(--f-mono)",
            fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase",
          }}>
            {state.error ? "error · " + state.error : "loading workflow…"}
          </div>}
    </WorkflowContext.Provider>
  );
}

function useWorkflow() {
  const ctx = React.useContext(WorkflowContext);
  if (!ctx) throw new Error("useWorkflow must be used inside <WorkflowProvider>");
  return ctx;
}

/* Devtools escape hatches — exposed on `window` so they can be run
   from the browser console when the UI's delete flow isn't enough
   (e.g. for shadow review-lane cards that don't get cascade-deleted
   when their parent reel id is missing). */
if (typeof window !== "undefined") {
  window.__resetWorkflow = () => {
    try {
      localStorage.removeItem("workflow.board.items.v1");
      localStorage.removeItem("workflow.store.v1");
    } catch (_) {}
    location.reload();
  };

  /* Hard-delete one or more reels straight from the DB. Bypasses the
     normal store actions so it works even if the UI delete button is
     somehow not reaching the row. Cascades clean up review-lane
     shadow cards, attached footage, and reel-scoped tasks via FK.
     Usage in browser console:
       __deleteReels('REEL-188','REEL-195')
       __deleteReels(['REEL-188','REEL-195'])              // also OK
  */
  window.__deleteReels = async (...args) => {
    const ids = args.flat().filter(Boolean);
    if (!ids.length) { console.log("usage: __deleteReels('REEL-188','REEL-195')"); return; }
    // Belt and braces: explicitly clear shadow cards that share the
    // parent id, in case some old row lost its FK in a prior schema
    // change. Cascade should already handle them.
    const r1 = await supabase.from("review_lane_cards").delete().in("parent_id", ids);
    const r2 = await supabase.from("reels").delete().in("id", ids);
    if (r1.error) console.error("review_lane_cards delete:", r1.error);
    if (r2.error) console.error("reels delete:", r2.error);
    console.log("Deleted reels: " + ids.join(", ") + ". Refresh to confirm.");
  };
}

export { WorkflowProvider, useWorkflow, WorkflowContext };
