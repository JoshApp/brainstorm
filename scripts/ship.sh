#!/usr/bin/env bash
# Push the CURRENT session branch to origin. Use this instead of bare
# `git push` so the pre-push hook (typecheck) runs and a type error
# aborts before anything reaches the remote.
#
# Crucially: ship DOES NOT trigger a deploy under the multi-branch
# workflow. The GitHub Pages workflow only fires on push to `main`.
# Use `npm run live` when you want the work on the live URL.
#
# Why split: with multiple Claude sessions working in parallel, every
# checkpoint push was racing for the live URL. Ship is now the cheap,
# frequent backup; live is the deliberate go-live trigger.
#
# Passes any args through to git push:  npm run ship -- --force-with-lease
#
# Exit code: whatever git push returned. 0 = your work is on origin
# under the session branch.

set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

branch="$(git rev-parse --abbrev-ref HEAD)"

# Safety net: someone running `npm run ship` while on main probably meant
# to go live. Route them through the live script so the deploy actually
# triggers (and they pick up the divergence check + auto-return).
if [ "$branch" = "main" ]; then
  echo "[ship] you're on main — use 'npm run live' instead (ship pushes session branches only)."
  exit 1
fi

git push "$@"
