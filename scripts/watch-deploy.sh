#!/usr/bin/env bash
# Watch the GitHub Pages deploy for the CURRENT HEAD commit and report
# the result — without conflating PUSH success with DEPLOY outcome.
#
# Why this distinction matters: the agent's `npm run ship` is fired in
# the background, and the harness re-wakes the agent with the exit code.
# A non-zero exit gets reported as a failure. That's only useful when
# something is ACTUALLY broken — a 40s "queued but no runner yet" is
# perfectly fine and should NOT pop a false-alarm "ship failed."
#
# Exit codes (the contract the harness sees):
#
#   0 — Deploy SUCCEEDED, or is still in flight (queued / running) when
#       we hit our patience limit. The PUSH is safe in either case;
#       caller can re-run this script later if they want to keep watching.
#
#   1 — Deploy explicitly FAILED (failure / cancelled / timed_out).
#       Failed-step log is dumped above the exit so it's visible inline.
#
# Tunables via env (defaults are conservative — patient by default):
#   FIND_TIMEOUT   — seconds to keep polling for the run to register
#                    after the push (default 180).
#   WATCH_TIMEOUT  — seconds to keep watching once the run is found
#                    (default 600 = 10 min — covers a normal Pages run
#                    plus queueing under load).

set -uo pipefail

FIND_TIMEOUT="${FIND_TIMEOUT:-180}"
WATCH_TIMEOUT="${WATCH_TIMEOUT:-600}"

sha="$(git rev-parse HEAD)"
branch="$(git rev-parse --abbrev-ref HEAD)"
short="${sha:0:8}"

echo "[watch-deploy] HEAD ${short} on ${branch}"

# ── Phase 1: find the workflow run for this commit ──────────────────
# Multiple agents pushing back-to-back can queue runs; gh might not
# surface the new run for several seconds. Poll with backoff (2s →
# 5s cap) up to FIND_TIMEOUT.
run_id=""
start_ts=$(date +%s)
backoff=2
last_progress=0
while true; do
  run_id="$(gh run list --branch "$branch" --limit 10 \
            --json databaseId,headSha \
            -q "map(select(.headSha == \"$sha\")) | .[0].databaseId" 2>/dev/null || true)"
  if [ -n "$run_id" ] && [ "$run_id" != "null" ]; then break; fi
  now=$(date +%s)
  elapsed=$((now - start_ts))
  if [ "$elapsed" -ge "$FIND_TIMEOUT" ]; then
    echo "[watch-deploy] no run for ${short} after ${elapsed}s — likely still queued."
    echo "               push is safe. re-watch later with: bash scripts/watch-deploy.sh"
    exit 0
  fi
  # Progress ping every ~30s so it's clear the script is still alive.
  if [ $((elapsed - last_progress)) -ge 30 ]; then
    echo "[watch-deploy] still waiting for run to register (${elapsed}s elapsed)…"
    last_progress=$elapsed
  fi
  sleep "$backoff"
  if [ "$backoff" -lt 5 ]; then backoff=$((backoff + 1)); fi
done

echo "[watch-deploy] run ${run_id} found — watching (timeout ${WATCH_TIMEOUT}s)…"

# ── Phase 2: watch the run to completion ────────────────────────────
# `gh run watch --exit-status` exits non-zero on ANY non-success state
# (failure OR timeout OR cancelled). We wrap it in `timeout` so the
# script can't hang an agent forever; if we hit the wall, we re-check
# the run's status to tell "still running" apart from "failed."
gh_rc=0
timeout "${WATCH_TIMEOUT}s" gh run watch "$run_id" --exit-status >/dev/null 2>&1 || gh_rc=$?

# Resolve the run's terminal status. `status` is queued / in_progress /
# completed; `conclusion` is success / failure / cancelled / timed_out /
# (null while in flight).
status_line="$(gh run view "$run_id" --json status,conclusion \
               -q '.status + ":" + (.conclusion // "null")' 2>/dev/null || echo "unknown:null")"

case "$status_line" in
  completed:success)
    echo "[watch-deploy] ✓ deploy SUCCEEDED — live URL is current."
    exit 0
    ;;
  completed:failure | completed:cancelled | completed:timed_out)
    echo ""
    echo "[watch-deploy] ✗ deploy ${status_line##*:}. Failed-step log:"
    echo "────────────────────────────────────────────────────────"
    gh run view "$run_id" --log-failed 2>/dev/null | tail -60
    echo "────────────────────────────────────────────────────────"
    echo "[watch-deploy] full log: gh run view $run_id --log"
    exit 1
    ;;
  *)
    # Still queued / in_progress when we hit WATCH_TIMEOUT, or gh hiccup.
    # Treat as "push is safe, deploy still cooking" — not a real failure.
    echo "[watch-deploy] run still in flight (${status_line}) after ${WATCH_TIMEOUT}s — push is safe."
    echo "               keep watching: gh run watch $run_id"
    exit 0
    ;;
esac
