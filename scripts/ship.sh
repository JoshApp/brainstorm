#!/usr/bin/env bash
# One command to push AND know the result. Use this instead of bare
# `git push` so a red deploy surfaces immediately instead of on the
# next manual check.
#
#   1. git push (the pre-push hook typechecks first; a type error
#      aborts here before anything reaches CI).
#   2. watch the GitHub Pages run for this commit (patient — see
#      watch-deploy.sh for the timeouts).
#   3. on actual deploy failure, dump the failed step's log inline.
#
# Passes any args through to git push:  npm run ship -- --force-with-lease
#
# Exit code contract:
#   0 — push went through AND deploy is either green or still cooking
#       (queued / in-flight at the watch-deploy patience limit). The
#       work is safely on the remote.
#   non-zero — push failed, OR deploy explicitly FAILED. Inspect output.

set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

git push "$@" || exit $?
bash scripts/watch-deploy.sh
