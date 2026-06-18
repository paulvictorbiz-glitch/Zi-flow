# Handoff — last updated 2026-06-19

> Read this first when resuming. Then skim the top of CHANGELOG.md for change details,
> and the memory files in `C:\Users\Mi\.claude\projects\c--Users-Mi-Downloads-ziflow-project-final\memory\` for deeper context.

## TL;DR of this session
- **Resumed** to deploy the prior cleanup batch (`d930896`) + apply migration 0076. Both done — plus an incident along the way.
- **🔴 INCIDENT (fixed):** applying 0076's `"owner manage people"` policy took the live site down with **`infinite recursion detected in policy for relation people`** — the policy was ON `people` and queried `people`. That's what broke "Instagram IG analyze." Fixed live via a `SECURITY DEFINER` `auth_is_owner()` helper; verified under a real authenticated session (`7 rows, no recursion`). Commit `238759b`.
- **Migration drift found:** `0049_demo_sandbox.sql` was recorded applied but **never actually ran** (audit proved it — `is_demo_user()` etc. absent). Drift isolated to **0049 only**; all of 0050→0075 are genuinely present.
- **0076 applied §1/§3/§4** (people priv-esc, `attached_footage` authenticated-only, `reel_dna` owner/self) + verified; **§2 (owner-only DELETE) deferred** (depended on 0049). Un-marked 0049 + added a `DO-NOT-BULK-APPLY` guard. Commit `5ddb520`.
- **Deployed:** C2 (`vercel --prod`, READY) + C1 (`ig_webhook.py` → Hetzner, `ingest_enabled:true`). **Pushed** `main` + `ig-ingest-reconcile-contenttype` to origin.

## Where we left off
On `main` (local == `origin/main` == `238759b`). Everything from this session is **committed, pushed, deployed, and verified live.** Working tree has only the wrap-up doc edits (CHANGELOG/HANDOFF/change-log) uncommitted.

## Open blockers
- **None.** Production is healthy (IG analyze restored).

## Pending (written but not yet live)
- **0076 §2 (owner-only DELETE on reels/cards/tasks)** — deferred. Needs a rewrite against the REAL live policies (drop `"auth write reels/cards/tasks"` → split into team INSERT/UPDATE + owner-only DELETE, no `is_demo_user`).
- **0049 demo sandbox** — now `[pending]` and intentionally NOT applied (guard header in the file). **DEFERRED until the owner revisits the demo-sandbox project.** Do not bulk-apply.

## Next session — start here (owner asked to execute items 2–4)
1. **0076 §2 rewrite + apply** — owner-only DELETE on reels/cards/tasks, written against the live `"auth write"` policies (split into team INSERT/UPDATE + owner-only DELETE). Verify from a non-owner session.
2. **Local curl-TLS quirk** — the Bash env's `curl` can't TLS to `*.footagebrain.com` (exit 35); confirm/work around (use a node HTTPS client or verify from the Hetzner box) so prod health checks aren't misleading.
3. **Prune stale branches + ~12 agent worktrees** (`.claude/worktrees/agent-*`) left from prior workflow runs — `git worktree list` / `git worktree prune` + delete merged branches.
4. **(Deferred, owner will revisit)** the **demo sandbox** project (0049) — leave parked; do not apply.
5. *(Optional, offered)* security-engineer audit / codebase-restructure analysis — today's self-inflicted RLS hole makes a focused security pass worthwhile.

## Verification commands (to confirm current state on resume)
```bash
git log --oneline -3                      # 238759b rls recursion fix · 5ddb520 drift reconcile · d930896 cleanup batch
git status -sb                            # main == origin/main (clean apart from doc edits)
node --env-file=.env.local scripts/migrate.mjs | grep -E "0049|0076"   # 0049 [pending] (deferred), 0076 [applied]
ssh root@178.105.14.144 "curl -s https://api.footagebrain.com/api/ig/status"   # {"ok":true,"ingest_enabled":true,...}  (run from the BOX — local curl TLS-fails)
```
