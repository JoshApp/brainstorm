#!/usr/bin/env bash
# Promote the current session branch's tip to `main` + trigger deploy.
#
# The workflow:
#
#   - You develop on claude/<task-name>. Commit + push there freely
#     (`npm run ship`) — no race against other agents, since their
#     branches are separate. None of these pushes auto-deploy.
#
#   - When you want the work on the live URL, run `npm run live`. It:
#       1. Verifies the working tree is clean.
#       2. Fetches origin.
#       3. **Auto-rebases** the session branch onto origin/main if main has
#          moved ahead — silently in the no-conflict case, with the rebased
#          branch force-with-lease-pushed back to origin so the next `ship`
#          stays clean. Conflict aborts loud.
#       4. Fast-forwards REMOTE main to the session tip with a ref push
#          (git push origin <sha>:refs/heads/main). The GitHub Pages workflow
#          triggers off main.
#       5. Watches the deploy via scripts/watch-deploy.sh.
#
# WORKTREE-SAFE: this NEVER checks out `main` and never fetches into the local
# `main` ref. With multiple agents working in parallel, `main` is often checked
# out in ANOTHER worktree — and git refuses to check out (or fetch-into) a
# branch that's held elsewhere, which used to make `live` fail with "couldn't
# switch to main". We instead treat origin/main as the source of truth, rebase
# onto it, and fast-forward the REMOTE ref directly. The session branch stays
# checked out the whole time. The local `main` ref is updated only when it
# isn't checked out anywhere (purely a convenience; the deploy reads remote).
#
# Exit codes mirror watch-deploy: 0 = push is on main + deploy green or still
# cooking; 1 = rebase conflict, main push failed, OR deploy explicitly failed.
#
# Pass any args through to the main push:
#   npm run live -- --force-with-lease
# (You should almost never need this — fast-forward is the default.)

set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

orig_branch="$(git rev-parse --abbrev-ref HEAD)"

if [ "$orig_branch" = "main" ]; then
  echo "[live] already on main — pushing directly."
  bash scripts/ship.sh "$@"
  exit $?
fi

# Bail on uncommitted work — promoting a branch you haven't committed
# would silently leave changes behind on the session branch.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "[live] working tree has uncommitted changes — commit them first."
  git status --short
  exit 1
fi

session_sha="$(git rev-parse HEAD)"
short_sha="${session_sha:0:8}"
echo "[live] promoting ${orig_branch}@${short_sha} → main"

# Pull latest origin state.
if ! git fetch origin 2>/dev/null; then
  echo "[live] fetch from origin failed."
  exit 1
fi

# origin/main is the source of truth. May be empty on a first-ever deploy
# (the ref push below bootstraps it).
origin_main=""
if git rev-parse --verify --quiet refs/remotes/origin/main >/dev/null; then
  origin_main="$(git rev-parse refs/remotes/origin/main)"
fi

# Auto-rebase the session branch onto origin/main if main has moved past where
# this branch is based. Rebasing ONTO a remote-tracking ref never touches a
# checked-out branch, so it's worktree-safe. We stay on the session branch;
# then force-with-lease the rebased branch back so the next `ship` doesn't trip
# on a non-fast-forward.
if [ -n "$origin_main" ]; then
  merge_base="$(git merge-base "$origin_main" "$session_sha" 2>/dev/null || true)"
  if [ -n "$merge_base" ] && [ "$merge_base" != "$origin_main" ]; then
    ahead_count="$(git rev-list --count "${merge_base}..${origin_main}")"
    echo "[live] main is ${ahead_count} commit(s) ahead — rebasing ${orig_branch} onto origin/main."
    if ! git rebase "$origin_main"; then
      echo ""
      echo "[live] rebase hit conflicts — your work touches lines already on main."
      echo "       Resolve in the working tree, then:"
      echo "         git rebase --continue && npm run live"
      echo "       Or back out:"
      echo "         git rebase --abort"
      # Leave the rebase in progress; the user will resolve or abort.
      exit 1
    fi
    session_sha="$(git rev-parse HEAD)"
    short_sha="${session_sha:0:8}"
    echo "[live] rebased ${orig_branch} to ${short_sha} — syncing to origin."
    if ! git push --force-with-lease origin "$orig_branch"; then
      echo "[live] couldn't sync ${orig_branch} — origin/${orig_branch} moved during live."
      echo "       Investigate ('git fetch && git log origin/${orig_branch}'), then retry."
      exit 1
    fi
  fi
fi

# Fast-forward REMOTE main to the session tip — NO local checkout. This is the
# worktree-safe core: it doesn't matter which worktree (if any) holds main.
# Bootstraps origin/main if it doesn't exist yet (first deploy).
echo "[live] fast-forwarding origin/main → ${orig_branch}@${short_sha}"
push_rc=0
git push origin "${session_sha}:refs/heads/main" "$@" || push_rc=$?
if [ "$push_rc" -ne 0 ]; then
  echo "[live] push to main failed — main moved again during live (non-fast-forward)."
  echo "       Run 'npm run live' once more to rebase onto the new main and retry."
  exit "$push_rc"
fi

# Best-effort: keep the LOCAL main ref in step too — but ONLY when it isn't
# checked out in another worktree (moving a checked-out branch ref would desync
# that worktree's index/HEAD). Non-fatal; the deploy reads REMOTE main.
main_wt="$(git worktree list --porcelain 2>/dev/null \
  | awk '/^worktree /{wt=substr($0,10)} /^branch refs\/heads\/main$/{print wt; exit}')"
if [ -z "$main_wt" ]; then
  git update-ref refs/heads/main "$session_sha" 2>/dev/null || true
else
  echo "[live] note: local 'main' is checked out at ${main_wt} — left as-is (remote main updated)."
fi

# Watch the deploy — exit 0 means "push to main is safe + deploy is green or
# still cooking"; exit 1 means deploy explicitly failed.
bash scripts/watch-deploy.sh
watch_rc=$?

# Push the session branch to origin too so it tracks the promoted tip — keeps
# the stop-hook's "N unpushed commits" check quiet. Skip-on-error (the rebase
# path above may have already force-pushed it).
git push origin "$orig_branch" 2>/dev/null || true

exit "$watch_rc"
