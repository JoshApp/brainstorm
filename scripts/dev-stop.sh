#!/usr/bin/env bash
# Stop the persistent dev daemon that `npm run dev:all` leaves running.
# (The shim + game are stopped by Ctrl-C on dev:all; only the daemon lingers.)

PIDFILE="/tmp/delve-daemon.pid"
pid="$(cat "$PIDFILE" 2>/dev/null || true)"

if [[ -n "${pid:-}" ]] && kill "$pid" 2>/dev/null; then
  echo "[dev] stopped daemon (pid $pid)"
  rm -f "$PIDFILE"
else
  echo "[dev] no daemon running from dev:all (no live pid in $PIDFILE)"
fi
