# Run Verification — status & remaining work

A **living status doc** (started 2026-06-18). Companion to
`docs/ALPHA-AND-BACKEND.md`. The goal: leaderboard runs are
*replay-verified* — every claimed score is re-simulated from `seed + input
tape` and confirmed before it counts. Tagged **[DONE]** / **[GAP]** /
**[RISK]**.

## Verdict: feasible — the hard part is already solved

The thing that usually makes replay-verification infeasible — a mobile run
reproducing **bit-for-bit** on a server — is **proven done** here:
`Browser↔Node parity PROVEN — a Node replay reproduces a browser run
byte-for-byte` (+ the deterministic clock, seed-on-every-boot-path, entropy
audit). What's left is bounded engineering, not research.

## The pipeline, end to end

```
play (fixed-step) ─► input tape (seed + per-step intents)        [DONE]
   └─ recorder: harness/run-recorder.ts, captureStep in the sim
upload ─► IndexedDB queue ─► submit_run reducer on reconnect      [DONE]
   └─ src/net/run-store.ts, run-sync.ts
store  ─► pending_run table (claim + gzip tape, status=pending)   [DONE]
verify ─► scripts/verify-runs.ts (Node worker, NOT a reducer)     [DONE]
   └─ reads via spacetime sql (owner = admin gate), replays,
      writes verdict. SAFE policy: verify-or-pending, never reject.
replay ─► scripts/replay-run.ts (headless, multi-floor)          [DONE mechanism]
   └─ mirrors loader.tickPendingLoad; selftest climbs to depth 7.
```

Confirmed on **real data** (run 7: a 5,925-frame tape — 3,277 moving,
1,502 looking, 55 attacks — captured + stored + replayed). Capture, upload,
storage, the verifier, and the multi-floor mechanism all work.

## The gaps

- **[GAP] Interact under-captures in the LIVE path** (NOT the recorder). A
  real depth-3 run recorded **only 1 interact** (frame 4,785/5,925) despite
  ~3 descents + a weapon pickup. **Isolated 2026-06-18** with
  `scripts/test-interact-capture.ts`: a bus-driven run records **4/4**
  interacts — so the recorder + tape format + `setIntent` path are SOUND.
  The under-capture is therefore in how live taps reach `triggerInteract`,
  or in what counts as a "descent." Leading hypotheses:
  - **Not every descent is an interact.** Some floor changes are *fog-gate
    walkthroughs* (walk INTO the gate — captured as MOVEMENT, no interact)
    vs *stair interacts* (a tap). So 1 recorded interact may be the one
    stair tap; the others were movement-triggered and replay via the move
    stream — needs confirming the replay honours both.
  - **Screen/transition gating.** `triggerInteract` early-returns under
    `isWorldPausedByScreen()`; a lingering descent card / safe-room
    transition could swallow a tap.
  Pinning it needs LIVE instrumentation (chrome-devtools on Windows Chrome,
  or phone logging) — the headless harness can't reproduce the live tap
  path. Consequence today: a replayed run is likely unarmed + can't take
  stairs → `0 kills, depth 0`. **This is the blocker, and it's narrowed to
  the live input layer.**

  **Update 2026-06-18:** the replay descent path is now **proven sound** —
  `test-interact-capture.ts` drives a bus interact at an in-range stair and
  the interact sim system descends (depth 1 → 2). So record→replay→descend
  all work; the gap is *purely* live taps not reaching `triggerInteract`.

- **[GAP] Multi-floor parity unconfirmed on a real run.** Parity was proven
  single-floor; the headless multi-floor *mechanism* works (selftest), and
  the interact→descend replay path is now proven (above). A real multi-floor
  run reproducing byte-for-byte is still blocked only behind the live
  interact-capture gap (fix that → a real descending run should replay).

## Risks

- **[RISK] Float/trig determinism is fragile.** Proven for today's content;
  every new enemy/system is a chance to introduce a non-deterministic op
  that silently breaks parity. Permanent discipline cost (the sim-state /
  game-clock / bootstrap authorities exist to manage it), not a one-time fix.
- **[RISK] Build pinning.** The verifier must replay under the *exact* build
  a run was played on (game logic changes between builds). `build_version` is
  stamped; the worker doesn't yet check out / run per-build sims.

## Remaining checklist (bounded)

1. **Fix interact-capture completeness** — root-cause the descent-path drop;
   make it as reliable as attack. *(focused; same proven pattern)*
2. **Confirm multi-floor browser↔Node parity** on a real captured run.
3. **Verifier ops** — per-build replay pinning; tighten the verdict from
   verify-or-pending to reject-on-mismatch once parity is trusted.
4. **Hold determinism as content grows** — ongoing.

## Recommendation

Feasible and mostly built — but **not urgent for an alpha.** Today's state is
*trust-but-verify*: every run is captured, stored, and spot-checkable, and the
verifier never false-rejects. That's enough until there's a competitive board
worth cheating on. Finish the last mile (interact completeness → multi-floor
parity) with the determinism track (it owns the parity that makes this work),
when player competition justifies it.
