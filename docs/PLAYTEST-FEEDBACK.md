# Playtest Feedback — triage & plan (2026-06-03)

A friend's playtest. Grouped, tagged, and ordered so we clear it one item
at a time. Tags: **[bug]** broken, **[bal]** tuning, **[ux]**, **[feat]**
new system, **[content]**, **[?]** needs a decision (talk first).

Everything is interrelated — balance numbers must be read in synergy (a
reach nerf + an AoE nerf + a stamina gate all change how strong charged
multi-hit is, etc.). Don't tune one in isolation.

---

## A. Weapon & combat balance
- [ ] **[bal]** Spear reach **3m is way too much** → bring toward the saber's
  comfortable **~2.2m** (saber = the good baseline). Dagger's short reach is
  *fine* as the tradeoff for its speed/crit. (reach lives per-weapon /
  per-class in weapon-classes.ts.)
- [ ] **[bal]** **Crossbow + wand are way too strong** — no ammo, high damage,
  basically no drawback. Need a real cost (ammo? longer reload? the recover
  isn't enough). Ties to the stamina **[?]** below.
- [ ] **[?][bal]** **Charged attack is the meta** — too strong. Either nerf the
  charge bonus, or gate it behind **stamina** (see F).
- [ ] **[?][bal]** **Multi-hit/cleave is mostly OP.** Most attacks shouldn't
  cleave. Decide deliberately which steps/specials hit multiple
  (`maxTargets` per combo step in weapon-classes.ts) — e.g. only sweeps /
  the scythe / charged finishers, not the basic chain.
- [ ] **[bal]** **AoE hits everything** — needs a cap / falloff so an AoE
  doesn't clip every enemy + every prop in a wide radius.

## B. Projectiles (needs a rework)
- [ ] **[bug]** Projectiles **get stuck on obstacles**.
- [ ] **[bug]** Shots **don't reach enemies behind a low prop** — even a small
  floor vase blocks them. (We shipped "height-aware projectile collision /
  shots fly OVER low props" before — this is a regression or it's also
  catching the auto-aim LOS test on tiny props.)
- [ ] **[feat]** General **projectile system rework** — collision + LOS height
  awareness, not stopping on clutter.

## C. Stats & scaling
- [ ] **[bug]** **Stats don't re-apply during a run** — investigate (spent
  attributes / proficiency not taking effect mid-run, or resetting?).
- [ ] **[bal]** **Grit = +3 max HP/point is too much** (I set this) → drop to
  ~+1–2 (CONFIG.ATTR.GRIT_HP_PER_POINT).
- [ ] **[bal]** **Lifesteal is way too strong** off raw damage → rework to
  **chance-on-kill** or **every-N-kills** proc, not per-hit %.
- [ ] **[ux]** We **don't clearly explain which weapon scales with what** — the
  item card shows the gold bonus but not the scaling stat letter/attr.
  Surface "scales: Might (B)" on the weapon card.

## D. Item balance
- [ ] **[bal]** **Rings inconsistent** — some give flat damage, some only
  conditional. Normalise so picks feel comparable.
- [ ] **[bal]** **Regen potion is way too strong** → reduce heal/rate.
- [ ] **[bal]** General **item balance pass** once the above land.

## E. Inventory UX
- [ ] **[ux]** **Sort/flag NEW items** so the player instantly sees what they
  just picked up. (A "new" badge + sort-new-first.)
- [ ] **[ux]** **Item icons too small / unreadable** — "can barely tell it's a
  cloak." Bigger, clearer thumbnails.

## F. Movement & stamina  [?] — the big design fork
- [ ] **[?][feat]** **Stamina system?** Friend wants **sprint / dash-dodge**,
  and charged-attack/ranged spam needs a drawback. Stamina could gate all
  three. Question: **feasible on mobile without cluttering the HUD?**
  (a thin stamina ring under the reticle / round the joystick, auto-hiding
  when full?) Decide before touching charged-attack/ranged/dodge balance.

## G. Level / world bugs
- [ ] **[bug]** **Props float above carved holes** — prop placement doesn't
  account for the floor holes (related to the boss-hole carving). Don't
  place props over hole cells.
- [ ] **[bug]** **Arena door never reopened** after the arena looked cleared
  (clear-detection or the reopen trigger failed).
- [ ] **[bug]** **Arena gate only sealed ONE random entrance** — an arena must
  seal **ALL** entrances on engage and reopen them ALL on clear.
- [ ] **[bug]** **Levels lost on reload** — save/persistence not restoring the
  current floor properly.

## H. Save & main menu
- [x] **[bug/ux]** With a run ongoing, **CONTINUE is now the prominent
  button**; starting anew is a muted "NEW RUN" behind a confirm. *(done)*
- [x] **[feat]** **Accidental run deletion** → "ABANDON RUN?" confirm before
  wiping (safe "keep" is the prominent choice). Save slots deferred. *(done)*

## I. Content
- [ ] **[content]** Promote the **new skeleton boss to the Floor-2 boss.**

---

## Proposed order (bugs → balance → UX → features)
1. **Quick correctness bugs** (data-loss + blatantly broken): levels-lost-on-
   reload, stats-don't-reapply, CONTINUE-prominent + wipe-confirm, arena
   gate (all entrances) + door-reopen, props-over-holes.
2. **Projectiles** (B) — behind-prop / stuck (their own rework).
3. **Balance tunes** (mostly config): grit HP, spear reach, regen potion,
   lifesteal rework, crossbow/wand, multi-hit, AoE — tuned *together*.
4. **Inventory UX** (E): new-flag/sort + bigger icons; scaling clarity (C).
5. **Skeleton boss → Floor 2** (I).
6. **Stamina + sprint/dodge** (F) — the feature, after the design decision.
7. Item balance polish (D) last, once systems settle.

## Decisions (resolved 2026-06-03)
- **Stamina: YES.** A stamina pool gates charged attacks + ranged shots +
  the new sprint/dash-dodge. Mobile HUD: a thin auto-hiding gauge (ring
  around the joystick or under the reticle). Built LAST (step 6); the
  charged-attack/ranged nerfs hang off it.
- **Run deletion: confirm prompt** (CONTINUE prominent when a run is live;
  "abandon run?" confirm before DESCEND wipes). Save slots = later, maybe.
- Starting with the **correctness bugs** (step 1).

## Still to decide (when we reach them)
- **Multi-hit philosophy** — which exact attacks may cleave.
- **Projectile rework scope** — fix the LOS/collision height test, or broader.
