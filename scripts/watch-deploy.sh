#!/usr/bin/env bash
# Watch the GitHub Pages deploy for the CURRENT HEAD commit and report
# the result — so we don't have to open the Actions tab after a push.
#
# Flow:
#   1. Wait for a workflow run whose headSha == HEAD to register
#      (a few seconds after push).
#   2. Block until that run completes (gh run watch).
#   3. On success: print a one-line OK.
#      On failure: dump the FAILED step's log so the error is visible
#      right here — no context switch to fix it.
#
# Usage: scripts/watch-deploy.sh   (run right after `git push`)
# Exit code mirrors the run: 0 = success, non-zero = failure/timeout.

set -uo pipefail

sha="$(git rev-parse HEAD)"
branch="$(git rev-parse --abbrev-ref HEAD)"
short="${sha:0:8}"

echo "[watch-deploy] waiting for run on ${branch} @ ${short}…"

# Poll for the run keyed to this exact commit (up to ~40s).
run_id=""
for _ in $(seq 1 20); do
  run_id="$(gh run list --branch "$branch" --limit 10 \
            --json databaseId,headSha \
            -q "map(select(.headSha == \"$sha\")) | .[0].databaseId" 2>/dev/null || true)"
  if [ -n "$run_id" ] && [ "$run_id" != "null" ]; then break; fi
  sleep 2
done

if [ -z "$run_id" ] || [ "$run_id" = "null" ]; then
  echo "[watch-deploy] no run found for ${short} after ~40s (still queued?)."
  echo "               check: gh run list --branch $branch"
  exit 2
fi

echo "[watch-deploy] watching run ${run_id}…"
if gh run watch "$run_id" --exit-status >/dev/null 2>&1; then
  echo "[watch-deploy] ✓ deploy SUCCEEDED — live URL is current."
  exit 0
fi

echo ""
echo "[watch-deploy] ✗ deploy FAILED. Failed-step log:"
echo "────────────────────────────────────────────────────────"
gh run view "$run_id" --log-failed 2>/dev/null | tail -60
echo "────────────────────────────────────────────────────────"
echo "[watch-deploy] full log: gh run view $run_id --log"
exit 1
