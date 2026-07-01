# Loot Economy — Punch-List

> **STATUS: ACTIVE — pass started 2026-06-15.** Tracks the "loot feels
> flooded / unrewarding" thread and what's been done about it. Companion
> to the loot roller (`src/content/loot.ts`) and the transaction economy.

## The principle

**Loot feels good through anticipation + payoff + clarity** — and meaning
comes from **scarcity + contrast + a sink**, never from volume. Flooding
kills all three (chests everywhere → no anticipation; mostly consumables/
trash → diluted payoff; too much stuff → no clarity). The fixes:

- **Health is a designed economy, not litter** (Souls Estus: fixed
  charges, refilled at the fire) — scattered infinite potions dissolve
  tension.
- **Keys are informed, not silent RNG** — either guaranteed against their
  lock, or missable *but surfaced in the HUD* so a miss is a choice.
- **Everything you pick up feeds a sink** (sell / currency) so abundance
  isn't clutter.
- **Rare drops are gated + telegraphed** (light doctrine) so rare reads
  as rare.
- **Derive from data** — rewards and descriptions come from the item's
  actual fields, not chance or hand-authoring.

## Done this pass

- **`describeItem` completeness** (`ui/inventory-details.ts` + pure
  formatters in `ui/item-format.ts`). It skipped the **item-level
  `onHit`** (the Acid Tongue slime-boss amulet showed armor but not its
  poison), `conditionalModifiers`, `consumableMutation`, and the reactive
  weapon verbs (`onRiposte`/`onPerfectDodge`/`onEmpoweredHit`) +
  `chargedEffect`. Now every effect field self-describes — no item can
  show empty/half. New pure formatters `formatCombatVerb`,
  `formatChargedEffect`; tests added.
- **Rarity FLOOR on `rollLoot`** (`content/loot.ts`, new `minRarity` in
  `LootContext`). The curve never dropped below ~weight-8 mundane, so even
  a boss-bias reward landed mundane ~half the time. A floor clamps the
  roll up and the step-down bottoms out *at* the floor. Tests added
  (floor holds; minDepth gating still respected).
- **Challenge altar rewards floored** (`interactables/challenge-offering.ts`).
  A trial is PAID for with the fight, so its hoard floors at **uncommon
  (floors 1–2) / rare (floor 3+)** — never "fight a wave for one healpot."
  Bias 4 still sets the ceiling.
- **Heal nerf** — `healing-potion.consumableHeal 4 → 2` (`content/items.ts`).
  Half-bar heals (of `PLAYER_HP_MAX 8`) made attrition meaningless; a
  quarter-bar top-up keeps healing a managed resource (carry 3 = sustain,
  not invulnerability).
- **Bronze / silver / gold chest tiers** — a small, glance-legible Isaac-
  style ladder (renamed from supply/iron/boss), each with a distinct
  PROMISE via a new `category` filter on `rollLoot`: **bronze** = wood,
  consumables (isolates the potion flood — heals come from marked bronze
  chests, not every chest); **silver** = iron, gear; **gold** = ornate,
  gear with a depth-scaled rarity floor (the prize, never a let-down).
  Distinct models already existed, so the silhouette telegraphs the tier
  across the room. `category` relaxes rather than returning null. Tests
  added.

## Next (prioritized)

1. **Keys: real channel + HUD** (Josh's call: missable, *not* guaranteed).
   Pull `skeleton-key` out of the gear-diluted `rare` band (it drops
   ~0% today) onto a dedicated scarce channel (warded-chest guardian /
   elites / flat low chance). Add a **HUD key count** + locked chests
   that *read* as locked; a left-behind warded chest gets a voice
   murmur — informed regret, not invisible RNG. The **warded chest** is
   the natural 4th tier — it slots into the bronze/silver/gold ladder once
   keys exist (gold-locked), reusing the `category` + `minRarity` seams.
2. **Density + trash→sink** — cut overall chest count (esp. bronze) so
   each lands; make junk reliably convert to gold and gold feed the
   merchant/altars, so trash volume (fine in itself) stops being clutter.
3. **Estus heal economy** (bigger, systemic) — DECIDED 2026-07-01: full Estus
   flask, PER-RUN (meta capacity growth deferred). Healing loot tiers by rarity:
   rare gated **flask shards** (+charge / +heal, from boss/elite/gold/challenge),
   uncommon one-off **refill draughts**, common heal slots → **currency/sink**.
   Fountains stay their own gamble (untouched).
   - **Stage 1 DONE** — the flask itself: `src/player/flask.ts` (pure per-run
     charge state), `CONFIG.FLASK`, an always-present primary heal button in the
     consumable bar bound to it, **refill on bonfire REST** (`fate-fire.ts`, once
     per fire), and per-run persistence in `run-state` (reset on new run, restored
     on continue). flask.ts stays health-free so `run-state → flask` doesn't cycle.
   - **Stage 2 (next)** — retire `healing-potion` from the ~12 enemy drop tables:
     convert it into the refill-draught, add the flask shards (rare/gated), route
     common heal slots to currency. Then the loot-density + trash→sink pass (#2).
   Deepens the push-vs-bank-at-the-fire tension from `THE-DUNGEON-NOTICES.md`.
