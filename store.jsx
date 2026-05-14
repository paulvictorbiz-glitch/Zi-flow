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
import { PEOPLE, ROLES } from "./shared-data.jsx";
import { supabase } from "./supabase-client.js";

/* ---------- camelCase ↔ snake_case mappers ---------- */
function reelFromDb(row) {
  if (!row) return row;
  const { blocker_role, prev_owner, variant_progress, fb_query,
          attach_url, due_at, stage_entered_at, archived_at,
          created_at, updated_at, ...rest } = row;
  return {
    ...rest,
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
  const { parent_id, created_at, updated_at, ...rest } = row;
  return { ...rest, parentId: parent_id ?? undefined };
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
        const next = { ...r, stage: action.stage };
        if (action.stage !== r.stage) next.stageEnteredAt = stamp;
        if (action.stage === "review" && r.stage !== "review") {
          next.prevOwner = r.owner;
        }
        if (action.lane !== undefined) {
          next.lane = action.lane;
          if (action.lane !== "review" && PEOPLE[action.lane]) {
            next.owner = action.lane;
          }
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

    case "APPROVE_REVIEW": {
      const stamp = action.stageEnteredAt || new Date().toISOString();
      return {
        ...state,
        reels: state.reels.map(r =>
          r.id === action.id
            ? { ...r, stage: "ready", state: "ok", blocker: null,
                blockerRole: null, age: "approved",
                stageEnteredAt: stamp,
                next: "Hold for post window" }
            : r),
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
          return { ...r,
            stage: "main", state: "warn",
            owner: target, lane: target,
            blocker: "Sent back for revision",
            blockerRole: "skilled",
            age: "just now",
            stageEnteredAt: stamp,
            next: "Address review notes" };
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
            return { ...r, stage: "selected", state: "ok", blocker: null,
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

async function persistMoveStage(state, id, { lane, stage }) {
  const isCard = state.reviewLaneCards.some(c => c.id === id);
  const table = isCard ? "review_lane_cards" : "reels";
  const reel = (isCard ? state.reviewLaneCards : state.reels).find(r => r.id === id);
  if (!reel) return;
  const patch = { stage };
  if (lane !== undefined) {
    patch.lane = lane;
    if (!isCard && lane !== "review" && PEOPLE[lane]) patch.owner = lane;
  }
  if (stage === "review" && reel.stage !== "review" && !isCard) {
    patch.prev_owner = reel.owner;
  }
  // Stamp stage entry — reels table only, shadow cards don't carry this.
  if (!isCard && reel.stage !== stage) {
    patch.stage_entered_at = new Date().toISOString();
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

/* ---------- Context + provider ---------- */
const WorkflowContext = React.createContext(null);

const INITIAL_STATE = {
  reels: [],
  reviewLaneCards: [],
  tasks: [],
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
        const [reelsRes, cardsRes, tasksRes] = await Promise.all([
          supabase.from("reels").select("*"),
          supabase.from("review_lane_cards").select("*"),
          supabase.from("tasks").select("*"),
        ]);
        if (reelsRes.error) throw reelsRes.error;
        if (cardsRes.error) throw cardsRes.error;
        if (tasksRes.error) throw tasksRes.error;
        if (cancelled) return;
        dispatch({ type: "HYDRATE", payload: {
          reels: (reelsRes.data || []).map(reelFromDb),
          reviewLaneCards: (cardsRes.data || []).map(cardFromDb),
          tasks: (tasksRes.data || []).map(taskFromDb),
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
    loaded: state.loaded,
    error: state.error,
    dispatch,
    actions: {
      moveStage: (id, { lane, stage }) => wrap(
        { type: "MOVE_STAGE", id, lane, stage },
        (s) => persistMoveStage(s, id, { lane, stage })),

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

      // Approve/SendBack/Triage compose existing primitives — they
      // produce a known target shape and a single UPDATE_REEL
      // persist is sufficient.
      approveReview: (id) => {
        const stamp = new Date().toISOString();
        dispatch({ type: "APPROVE_REVIEW", id, stageEnteredAt: stamp });
        persistUpdateReel(stateRef.current, id, {
          stage: "ready", state: "ok", blocker: null,
          blockerRole: null, age: "approved",
          stageEnteredAt: stamp,
          next: "Hold for post window",
        }).catch(e => {
          console.error(e);
          dispatch({ type: "SET_ERROR", error: e.message || String(e) });
        });
      },

      sendBack: (id) => {
        const r = stateRef.current.reels.find(x => x.id === id);
        const editor = ROLES.skilled?.person;
        const target = r?.prevOwner || editor || r?.owner;
        const stamp = new Date().toISOString();
        dispatch({ type: "SEND_BACK", id, stageEnteredAt: stamp });
        persistUpdateReel(stateRef.current, id, {
          stage: "main", state: "warn",
          owner: target, lane: target,
          blocker: "Sent back for revision",
          blockerRole: "skilled",
          age: "just now",
          stageEnteredAt: stamp,
          next: "Address review notes",
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

/* Devtools escape hatch */
if (typeof window !== "undefined") {
  window.__resetWorkflow = () => {
    try {
      localStorage.removeItem("workflow.board.items.v1");
      localStorage.removeItem("workflow.store.v1");
    } catch (_) {}
    location.reload();
  };
}

export { WorkflowProvider, useWorkflow, WorkflowContext };
