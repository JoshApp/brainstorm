#!/usr/bin/env bash
# One command to push AND know the result. Use this instead of bare
# `git push` so a red deploy surfaces immediately instead of on the
# next manual check.
#
#   1. git push (the pre-push hook typechecks first; a type error
#      aborts here before anything reaches CI).
#   2. watch the GitHub Pages run for this commit to completion.
#   3. on failure, dump the failed step's log right here.
#
# Passes any args through to git push:  npm run ship -- --force-with-lease
# Exit code: 0 only if BOTH the push and the deploy succeed.

set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

git push "$@" || exit $?
bash scripts/watch-deploy.sh
