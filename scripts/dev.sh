#!/usr/bin/env bash
# One-command dev stack for the AI prototype:
#   daemon-core (:7429)  +  voice-shim (:8787)  +  vite (the game)
#
# The AI layer is best-effort — the game runs fine without any of this — but
# this brings up the whole "the deep speaks" loop in a single terminal. Ctrl-C
# tears the whole stack down.
#
#   npm run dev:all
#
# Env:
#   DELVE_DAEMON_DIR   path to daemon-core/daemon (default: the aiinfluencer checkout)
#   VOICE_MODEL        sonnet (default) | opus | haiku
#   VOICE_USE_BRIDGE   0 = SDK mode / clean stdio subprocess (default, simplest for dev)
#                      1 = bridge mode (tmux + Max pool)
#   SKIP_DAEMON=1      manage the daemon yourself; just run shim + vite

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DAEMON_DIR="${DELVE_DAEMON_DIR:-/home/josh/aiinfluencer/daemon-core/daemon}"
export VOICE_MODEL="${VOICE_MODEL:-sonnet}"
export VOICE_USE_BRIDGE="${VOICE_USE_BRIDGE:-0}"   # default: no bridge

# Stop the shim + game on Ctrl-C. The daemon is deliberately LEFT RUNNING
# (it's a slow-booting persistent service) so the next `dev:all` is instant —
# stop it explicitly with `npm run dev:stop`.
trap 'echo; echo "[dev] stopping shim + game (daemon left running — npm run dev:stop to kill it)"; pids="$(jobs -p)"; [[ -n "$pids" ]] && kill $pids 2>/dev/null || true' EXIT INT TERM

DAEMON_LOG="/tmp/delve-daemon.log"
DAEMON_PIDFILE="/tmp/delve-daemon.pid"

# Liveness check without curl: is something listening on :7429?
daemon_up() { (echo >/dev/tcp/127.0.0.1/7429) 2>/dev/null; }

# 1. daemon-core — the Claude Code session host the shim talks to. Started
#    DETACHED (nohup-style) so it survives this script and is reused next run;
#    the slow type-stripping boot then happens at most once.
if [[ "${SKIP_DAEMON:-0}" != 1 ]]; then
  if daemon_up; then
    echo "[dev] daemon already up on :7429 (reused — skipping the slow boot)"
  elif [[ -d "$DAEMON_DIR" ]]; then
    echo "[dev] starting daemon-core ($DAEMON_DIR) → log: $DAEMON_LOG"
    echo "[dev] first boot is slow (type-stripping the whole daemon); it stays running so next time is instant"
    ( cd "$DAEMON_DIR" && exec node --experimental-strip-types src/start.ts ) >"$DAEMON_LOG" 2>&1 &
    DAEMON_PID=$!
    echo "$DAEMON_PID" >"$DAEMON_PIDFILE"
    disown "$DAEMON_PID" 2>/dev/null || true   # survive Ctrl-C; not in jobs -p, so the trap won't kill it
    for _ in $(seq 1 60); do daemon_up && break; sleep 0.5; done
    if daemon_up; then
      echo "[dev] daemon ready (pid $DAEMON_PID, left running — npm run dev:stop to kill it)"
    else
      echo "[dev] WARN: daemon didn't come up in 30s — last log lines:"
      tail -n 8 "$DAEMON_LOG" 2>/dev/null | sed 's/^/[daemon] /'
      echo "[dev] the game still runs; the deep stays silent."
    fi
  else
    echo "[dev] WARN: no daemon on :7429 and none at $DAEMON_DIR"
    echo "[dev]       set DELVE_DAEMON_DIR, or SKIP_DAEMON=1 to silence this. The deep stays quiet."
  fi
fi

# 2. voice-shim — funnels /api/ai into daemon sessions (run the local binary so
#    Ctrl-C kills the real process, not just an npm wrapper).
echo "[dev] starting voice-shim on :8787 (model=$VOICE_MODEL, bridge=$VOICE_USE_BRIDGE)"
( cd "$ROOT" && exec node_modules/.bin/tsx server/voice-shim/voice-shim.ts ) &

# 3. vite (the game) — foreground. NOT exec'd, so the trap above still fires
#    and tears down the daemon + shim when this exits.
echo "[dev] ───────────────────────────────────────────────"
echo "[dev]  GAME →  http://localhost:5173/brainstorm/"
echo "[dev]  (note the /brainstorm/ — bare localhost:5173 is blank)"
echo "[dev]  phone:  open the Network URL vite prints just below"
echo "[dev]  shim :8787 · daemon :7429 · Ctrl-C stops everything"
echo "[dev] ───────────────────────────────────────────────"
cd "$ROOT" && npm run dev
