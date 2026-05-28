# First Claude Code Session — Copy-Paste Prompts

> **HISTORICAL.** These are the bootstrap prompts from the project's first week, when Phases 1-2 were the work. The game is past Phase 3 now — multi-room procgen, full combat, equipment, atmosphere polish all done. See `CLAUDE.md` for current state and what's next.
>
> Kept for archaeology: this is how the project was scoped initially.

---

## Session 0: Sanity check the starter

```
Read CLAUDE.md and README.md, then run `npm install` and `npm run dev`.
Confirm:
1. The dev server starts without errors
2. The TypeScript compiles cleanly
3. The starter scene loads (one dungeon room with flickering torch)

If anything is broken, fix it minimally — do not refactor. Then summarize what's working.
```

---

## Session 1: Atmosphere tuning (Phase 1 polish)

```
Read CLAUDE.md. We're in Phase 1, polishing atmosphere before moving to combat.

I just opened the build on my phone. Note what feels off. Possible directions:
- Torchlight flicker too uniform or too erratic
- Fog too dense or too sparse
- Walls reading too flat (no surface variation)
- Color palette too warm or too cold
- Camera FOV creates wrong sense of space

Pick ONE thing to iterate on per session. Change values in src/config.ts where possible.
If something needs new code, add it minimally — no architectural changes yet.
```

---

## Session 2: Multiple rooms + corridors

```
Read CLAUDE.md. Phase 1 is solid, atmosphere feels right on phone.

Now extend the dungeon: instead of one room, generate a small floor with 3-4 rooms
connected by corridors. Each room has its own torch. Corridors are narrower and
have torches at intervals.

Requirements:
- Floor layout is hand-coded for now (no procgen yet)
- Walls actually block movement (add collision)
- Player spawns in the first room
- Stairs visible at the back of the last room (do nothing yet, just visible)

Keep all tuning in src/config.ts. Add room/corridor dimensions there too.
```

---

## Session 3: First mob (Phase 2 begins)

```
Read CLAUDE.md. We're entering Phase 2. The phase pillar is CRUNCHY COMBAT.

Build the first mob:
- Composed of Three.js primitives only (capsule body + sphere head)
- Color: dark, desaturated, slightly different from walls
- Spawns in a back room
- Simple AI: idle until player enters its room, then walks toward player
- When in attack range (~1.5m), it winds up (0.4s) and swings
- If hit lands, player takes damage
- Mob has HP, dies when depleted, vanishes for now (loot comes later)

NO combat polish yet. Just functional mob + player damage exchange.
Polish (hit-pause, screen shake, sound) comes in the NEXT session.
```

---

## Session 4: Combat crunch

```
Read CLAUDE.md. Mob and damage exchange work. Now we make it CRUNCHY.

Implement, in order:
1. Hit-pause: 80ms freeze on every connecting hit (both player landing and player taking).
   This is THE most important feel feature. Get it right first.
2. Screen shake: subtle on player landing a hit, more aggressive on player taking damage.
3. Haptic: navigator.vibrate(20) on hit landed, vibrate(60) on damage taken.
4. Sound: layered impact (load free SFX from Freesound or generate placeholder beeps for now).
5. Damage numbers: small text floating up from the hit point, fades fast.

After each one, ASK ME to test on my phone before moving to the next.
Combat feel is iterative — we tune it together.
```

---

## Session 5: Player attack feel

```
Read CLAUDE.md. Mobs hit hard now. Time to make player attacks feel good.

Add:
- Tap right side of screen to attack
- Player has an attack windup (200ms) and recovery (300ms) where input is locked
- During recovery, "RECOVERY" subtly indicated (camera-dip or vignette)
- Raycast from camera forward to detect mob hit
- On hit: deal damage + trigger all the crunch effects from Session 4 (hit-pause, shake, haptic, sound)
- Stamina: each attack costs 25% of stamina bar, regenerates over 2s of no attacks
- Empty stamina = cannot attack until at least 25% regenerated

Tune all timings in src/config.ts.
```

---

## After Phase 2: Pause and Evaluate

Once Phases 1 and 2 are working — atmosphere + crunchy combat — STOP and play it for a week. 
Iterate only on feel. Do not add features.

If after a week you genuinely enjoy picking up your phone to play it for 5 minutes, you have a real prototype. 
Continue to Phase 3 (multi-floor dungeon).

If you don't, something is wrong with combat or atmosphere. Iterate, don't expand.

This is the discipline that separates shipped games from forever-prototypes.
