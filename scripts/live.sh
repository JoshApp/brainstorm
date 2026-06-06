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
#       2. Fetches origin, creates/updates local `main` from origin.
#       3. **Auto-rebases** the session branch onto main if main has
#          moved ahead — silently in the no-conflict case, with the
#          rebased branch force-with-lease-pushed back to origin so
#          the next `ship` stays clean. Conflict aborts loud (we
#          don't paper over work that touches the same lines).
#       4. Fast-forward merges session HEAD into main.
#       5. Pushes main. The GitHub Pages workflow triggers off main.
#       6. Watches the deploy via scripts/watch-deploy.sh.
#       7. Returns to your session branch when done.
#
# What changed (vs. the older "abort on divergence" version): with
# multiple Claude sessions racing to ship to main, the abort fired so
# often that the user lost a minute every other ship just to type the
# rebase command. The new behaviour folds in other agents' work
# automatically whenever the changes don't conflict, and only stops
# you when there's a real merge decision to make.
#
# Exit codes mirror watch-deploy: 0 = push is on main + deploy green or
# still cooking; 1 = rebase conflict, main push failed, OR deploy
# explicitly failed.
#
# Pass any args through to `git push origin main`:
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

# Ensure a local `main` exists. Three cases:
#   - origin has main → track it.
#   - no main anywhere → create from current session HEAD (first-time
#     bootstrap, so `main` starts at the work you're about to ship).
#   - local main exists already → leave it; we'll fast-forward below.
if ! git rev-parse --verify --quiet refs/heads/main >/dev/null; then
  if git rev-parse --verify --quiet refs/remotes/origin/main >/dev/null; then
    git branch main origin/main
  else
    echo "[live] no main branch anywhere — bootstrapping from ${orig_branch}."
    git branch main "$session_sha"
  fi
fi

# Update local main to match origin (so the rebase check sees the real
# divergence, not a stale local view).
if git rev-parse --verify --quiet refs/remotes/origin/main >/dev/null; then
  git fetch origin main:main 2>/dev/null || git update-ref refs/heads/main refs/remotes/origin/main || true
fi

# Auto-rebase the session branch onto main if main has moved past
# where this branch is based. We stay on the session branch for the
# rebase so HEAD ends up at the rebased tip; then force-with-lease
# push the session branch so the next `ship` doesn't trip on a
# non-fast-forward.
main_sha="$(git rev-parse main)"
merge_base="$(git merge-base main "$session_sha" 2>/dev/null || true)"

if [ -n "$merge_base" ] && [ "$merge_base" != "$main_sha" ]; then
  ahead_count="$(git rev-list --count "${merge_base}..${main_sha}")"
  echo "[live] main is ${ahead_count} commit(s) ahead — rebasing ${orig_branch} onto main."
  if ! git rebase main; then
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

# Fast-forward main to the (possibly-just-rebased) session tip.
git checkout main >/dev/null 2>&1 || { echo "[live] couldn't switch to main."; exit 1; }
if ! git merge --ff-only "$session_sha" 2>/dev/null; then
  # Shouldn't be reachable after a successful rebase, but handle the
  # race where main moved between our fetch and now.
  echo "[live] couldn't FF main onto ${orig_branch} — main moved again."
  echo "       Run 'npm run live' once more to pick up the new tip."
  git checkout "$orig_branch" >/dev/null 2>&1 || true
  exit 1
fi

# Push main; this triggers the GitHub Pages workflow.
push_rc=0
git push -u origin main "$@" || push_rc=$?
if [ "$push_rc" -ne 0 ]; then
  echo "[live] push to main failed — main probably moved during live."
  echo "       Run 'npm run live' again to pick up the new tip."
  git checkout "$orig_branch" >/dev/null 2>&1 || true
  exit "$push_rc"
fi

# Watch the deploy — exit 0 means "push to main is safe + deploy is
# green or still cooking"; exit 1 means deploy explicitly failed.
bash scripts/watch-deploy.sh
watch_rc=$?

# Hop back to the session branch so subsequent commits keep landing there.
git checkout "$orig_branch" >/dev/null 2>&1 || true

# Also push the session branch to origin so it tracks the new tip
# (== main). Without this, origin/${orig_branch} lags behind local
# every time we live without a prior ship, and the stop-hook
# complains "N unpushed commit(s) on branch X." Skip-on-error: if
# the session branch was already pushed during the rebase step
# above, this is a no-op; if origin's branch moved, we don't want
# to force-with-lease here (the rebase path already handles that).
git push origin "$orig_branch" 2>/dev/null || true

exit "$watch_rc"
