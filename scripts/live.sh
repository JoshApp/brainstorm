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
#       1. Verifies the working tree is clean (nothing uncommitted).
#       2. Fetches origin, creates/updates a local `main` tracking
#          origin/main (or makes one from session HEAD if none exists).
#       3. Fast-forward merges the session HEAD into main. If main has
#          diverged (someone else shipped first), aborts and tells you
#          to rebase locally — you decide what to integrate.
#       4. Pushes main. The GitHub Pages workflow triggers off main.
#       5. Watches the deploy via scripts/watch-deploy.sh.
#       6. Returns to your session branch when done.
#
# Exit codes mirror watch-deploy: 0 = push is on main + deploy green or
# still cooking; 1 = main push failed, OR deploy explicitly failed.
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

# Update local main to match origin (so the FF check below sees the
# real divergence, not a stale local view).
if git rev-parse --verify --quiet refs/remotes/origin/main >/dev/null; then
  git fetch origin main:main 2>/dev/null || git update-ref refs/heads/main refs/remotes/origin/main || true
fi

# Fast-forward main to the session tip. If they've diverged (someone
# else shipped a different branch into main), abort — the user has to
# decide what to integrate, not the script.
git checkout main >/dev/null 2>&1 || { echo "[live] couldn't switch to main."; exit 1; }
if ! git merge --ff-only "$session_sha" 2>/dev/null; then
  echo ""
  echo "[live] main has diverged from ${orig_branch} — someone else shipped first."
  echo "       Rebase your session branch on top of main, then retry:"
  echo "         git checkout ${orig_branch} && git rebase main && npm run live"
  git checkout "$orig_branch" >/dev/null 2>&1 || true
  exit 1
fi

# Push main; this triggers the GitHub Pages workflow.
push_rc=0
git push -u origin main "$@" || push_rc=$?
if [ "$push_rc" -ne 0 ]; then
  echo "[live] push to main failed — returning to ${orig_branch}."
  git checkout "$orig_branch" >/dev/null 2>&1 || true
  exit "$push_rc"
fi

# Watch the deploy — exit 0 means "push to main is safe + deploy is
# green or still cooking"; exit 1 means deploy explicitly failed.
bash scripts/watch-deploy.sh
watch_rc=$?

# Hop back to the session branch so subsequent commits keep landing there.
git checkout "$orig_branch" >/dev/null 2>&1 || true

exit "$watch_rc"
