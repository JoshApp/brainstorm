# DELVE — The Item Grammar (research-grounded)

> **STATUS: RESEARCH COMPLETE 2026-07-19 (both rounds).** Round 1: 8 roguelikes,
> 24 sources, 23 claims surviving 3-vote adversarial verification. Round 2
> (targeted): the hand-authored synergy pole — Hades duos + Gungeon tags —
> verified in detail (§7); celebrated-items consensus largely failed
> verification (only RoR2's Shaped Glass survived) and stays an open question.
> Claims are tagged **[V]** verified (survived 3-0), **[bg]** background
> knowledge (not independently verified).
>
> Companion to `RELICS.md` (the lane), `BUILD-ECONOMY.md` (the four lanes),
> `STATUS-EFFECTS.md` (the substrate). This doc is the authoring brief for item
> design: the cross-game grammar, where DELVE already complies, the engine gaps,
> and the authoring rules.

---

## 1. The three load-bearing axes (what actually differs between great games)

### Axis 1 — Capacity: unbounded accretion vs attention-budgeted tableau

- **[V]** RoR2 and Slay the Spire are slotless and unbounded — no cap on
  distinct items or copies. Isaac likewise accretes everything.
- **[V]** Balatro is the deliberate opposite pole: ~5 removable Jokers.
  LocalThunk's first prototype made all 52 playing cards upgradeable and it
  FAILED on attention — "you're keeping track of 52 cards … I wanted that to
  not be the main thing." The cap is an attention budget, not a balance lever.

**DELVE's position — both poles, on purpose, one per tier.** The reliquary is
the unbounded accretion lane (relics = what you HAVE); the tarot Spread is the
capped tableau (majors = who you ARE, 2–3 per run). The research validates the
split hard: the 52-card lesson is exactly our "majors FEW and HEAVY, a minor is
never run-defining" guardrail. **Rule: the attention cost of a relic must stay
near zero — a relic may not demand per-fight tracking. Anything you must think
about belongs in the capped tier.**

### Axis 2 — Synergy architecture: where combinations come from

- **[V]** Emergence-from-substrate (Isaac): ~70% of items stack with one
  another because every item modifies the same player-character substrate;
  combos arise systemically, not from authored pairs. The documented COST:
  untestable combinatorics — the item-variable space was the admitted source of
  Isaac's launch bugs ("hundreds of testers several days").
- **[V]** Modern Isaac is a HYBRID: the emergent stat substrate plus
  hand-coded pairwise cases for tear-replacing weapons (Brimstone + Tammy's
  Head) — even the emergence archetype needed authored special-cases at the
  weapon layer.
- **[V]** RoR2's refinement: the stacking FORMULA is a per-item design axis —
  linear (Syringe +15%/stack), hyperbolic (diminishing chance stats),
  exponential (Fuel Cell ×0.85^stacks). One substrate, curve-controlled
  emergence, zero authored pairs.
- **[V]** Balatro: the combinatorics live in the 52-card substrate UNDER the
  item layer; the ~5-Joker tableau stays small enough to reason about.
- **PENDING (round 2):** the hand-authored pole — Hades duo boons, Gungeon's
  tagged pairs — fell out of round-1 verification.

**DELVE's position — substrate-emergence, already chosen and now validated:**
statuses (apply→amplify→detonate→feed), the health economy, tempo, and domain
counts (Resonance) are our shared substrate; relics compose it. Two lessons to
adopt:

1. **The QA-combinatorics cost is real — and we have the antidote:** a small
   pool (dozens, not 700) and the deterministic sim + autobot harness. **Rule:
   every relic that touches the substrate gets a headless scenario exercising
   its loop** (the blood-drinker scenario is the template).
2. **Plan for the hybrid:** pure emergence will not carry weapon-layer
   interactions. Our authored-pair channel already exists — **provenance sets**
   (distinct pieces of one dead delver at 2/3 thresholds) are structurally
   Hades duos with lore. Budget them deliberately (see round 2).

### Axis 3 — Rarity is drop-PLUMBING, not a power pyramid

- **[V]** Isaac: no named tiers in the drop math — per-pool weights (nearly all
  1.0; power expressed as FRACTIONAL weights: Mom's Knife 0.2, Epic Fetus 0.1),
  pools self-deduplicate (SEEING an item decrements its weight everywhere;
  taking removes it), and exhausted pools fall back to a joke item (Breakfast).
- **[V]** Slay the Spire: tiers double as SOURCE-EXCLUSIVITY channels — Shop
  relics only at the merchant, Event relics only from events; non-chest sources
  roll 50/33/17 common/uncommon/rare. (NOTE: "boss relics are always a
  pick-1-of-3" was REFUTED — do not repeat it.)
- **[V]** Gungeon: the pool is MID-HEAVY — B(164) and C(158) tiers are the
  largest, top-tier S(50) the smallest. The opposite of a rarity pyramid: most
  of the pool is workmanlike texture, the top is scarce by count.
- **[V]** RoR2: tiers are also BEHAVIORAL categories, not just power — Lunar =
  drawback items, Void = corrupting conversions.

**DELVE adoptions:**
- **Tiers as behaviour, not just power** — we already do this (cursed =
  rule-with-a-wound); hold the line: *mundane = numeric texture, uncommon =
  procs, rare = build-shapers, cursed = rules that cost.* Rarity gates SHAPE.
- **Mid/low-heavy pool by count** (Gungeon's shape, our 55/30/15 mix) —
  commons are most of the pool by count AND the majority of drops.
- **Source-exclusive channels** — the transaction grammar is our merchant/event
  layer: author DEAL-ONLY relics (blood-altar exclusives, tithe exclusives,
  merchant stock) that never enter floor drops. Provenance made literal: where
  you got it is part of what it is.
- **Seen-dedup** (Isaac's trick) — noted for later; at our pool size the roller
  doesn't need it yet, but when relic count passes ~50, decrement-on-seen keeps
  runs from repeating themselves.

---

## 2. The five verified anti-patterns (and our guards)

1. **[V] Dead stats — EV-losers.** Darkest Dungeon's crit trinkets were
   *mathematically* worse than flat damage; the 2018 "Critsmas" pass tripled
   them (3%→9%, 4%→12%, 5%→15%).
   **Guard:** every numeric relic passes an EV sanity check against the plain
   damage relic of its rarity — beat it, match it, or carry a second hook
   (theme/proc/stack-curve). No relic exists only to lose the comparison.
2. **[V] Denial-stat dominant strategies.** DD's stun+speed stacking became a
   stall meta ("the best stats in the game to stack"); the fix was
   three-pronged — item numbers down, counterplay up (post-stun resist),
   systemic referee (stall detection).
   **Guard:** control effects (chill, stagger/poise, fear when it lands) get
   capped or hyperbolic stacking from day one, and enemies get recovery
   counterplay. Never let "the enemy doesn't get to play" be the best build.
3. **[V] Rarity that stops mattering.** Dead Cells removed ++/S bonus stats
   entirely "to give back some importance to gear level."
   **Guard:** rarity gates design SHAPE (see Axis 3), not a stat multiplier
   that inflation erodes.
4. **[V] Synergy-affix bloat.** Dead Cells: "every item felt like it had 3 or 4
   DoT synergies, making it feel like there is no point in building your build
   around" — they capped damage-affixes at 2 per item.
   **Guard:** the domain affinity palette IS this cap — appliers stay
   concentrated in their domains, one `onHit` channel per item, and most
   commons DON'T proc. Scarcity of appliers is what makes an applier a build.
5. **[V] Economy levers that force any build.** Balatro's rerolls let players
   "force whatever build you want every single game"; LocalThunk's dedicated
   reroll-currency fix "just plain sucked" so he DELETED the system — his
   stated principle: one unfun system poisons every system it touches; delete
   wholesale, don't patch.
   **Guard:** the deep DEALS, you don't order. No reroll economy on relics or
   cards; the merchant stocks, never rerolls. (And the meta-principle for us:
   when a DELVE system tests unfun, kill it — don't fee it.)

**[V] The remedy philosophy that survives contact** (cross-studio): buff the
weak before nerfing the strong (Red Hook); delete unfun systems wholesale
(LocalThunk); triage with DATA — telemetry (Mega Crit's metrics-driven balance,
GDC 2019) or player polls (Motion Twin's weapon-rework poll). For us: the run
tapes / SpacetimeDB event log is the future telemetry seam — log relic
pickups + depth-at-death per relic from Phase 4, and balance from evidence.

---

## 3. DELVE's expressible vocabulary today (the diff target)

Verified from code 2026-07-19. This is what our machine can already say —
authoring composes THESE; anything an archetype needs beyond them is an engine
gap (§4).

- **Stat modifiers (16 kinds,** `combat/modifiers.ts`**):** max-hp,
  weapon-damage, damage-multiplier, finisher-damage-mult, physical/magic-armor,
  incoming-damage-mult, move/action-speed-mult, crit-chance (clamped),
  crit-mult, lifesteal-pct (chance-on-kill heal), bleed-chain (detonate),
  bleed-feed (conditioned heal). All sum linearly through one
  `aggregateModifiers` pipeline (equipment → reliquary → affixes → sets →
  mutations → cards).
- **Triggers** (`ecs/triggers.ts`): on hit / crit / killed / damaged / died /
  interval, chance-gated; effects damage / heal / apply-buff targeting self /
  victim / attacker. *Limit: `killed` carries no victim reference — no
  victim-state conditions.*
- **Statuses** (`content/buffs.ts`): burn (refresh, bursty), bleed (stacks 4,
  per-hit ramp), poison (stacks 4, magic-typed), chill (move+action slow),
  sunder (×1.35 incoming), plus regen/bloodthirst/ironhide/berserk/cursed.
  One-field VFX. Applied via weapon.onHit / item.onHit / enemy.onHit / rites.
- **Conditionals:** below/above-hp-pct only (the brink axis).
- **Transforms** (`combat/transforms.ts`): suppress-passive-heal; hp-drain
  (out-of-combat | per-floor). The rule-change tier, used by cards.
- **Rites** (active lane): nova / cost / heal / selfBuff, Hunger-fueled
  (+10 kill / +2 hit / +1 crit), morph tiers by held-domain count.
- **Identity tier for contrast** (cards): PACT / BRINK / PROC / RESONANCE
  (per-domain-kin scaling) / TRANSFORM.
- **Item shape:** kind 'relic' (uncapped), domain (9 abstracts w/ affinity
  palettes), rarity ×5, provenance flavor, setId (distinct-piece 2/3
  thresholds), drop {minDepth, weight, pool}.
- **Economy surfaces:** gold, keys, flask, Hunger, blood-altar HP-trades,
  tithe, phials, merchant, challenge offerings.

---

## 4. Gap analysis — engine hooks the grammar demands

Ranked by how much authoring surface each unlocks:

1. **Stack-curve axis on relic stacking** *(from RoR2, [V])* — today every
   stacked copy sums linearly. Add per-modifier curve: `stack: 'linear' |
   'hyperbolic' | 'exponential'`. Hyperbolic is the principled home for
   chance-like stats (crit-chance currently just clamps); exponential is the
   engine-relic thrill ("each copy multiplies"). Small change in
   `aggregateModifiers` (it already sees stacks); huge authoring axis.
2. **Victim-state trigger conditions** — `condition: { victimHasBuff:
   'bleed' }` on TriggerSpec + carry the victim (and a status snapshot) on
   `enemy:killed`. Unlocks the whole conditioned-payoff archetype
   ("bleeding kills X") beyond the two bespoke bleed flags.
3. **Tempo trigger events** — on-deflect, on-just-dodge, on-finisher,
   on-streak(n). The substrate charter names tempo as a pillar; today no item
   can touch it. This is the Grace/Valor/Forbidden relic lane.
4. **Economy trigger events** — on-gold-pickup, on-spend, on-chest-open,
   on-deal-struck. The Greed lane is unexpressable today.
5. **More Transform rules** — the cursed/grotesque tier wants: heal-only-by-X,
   max-hp-cap, light-radius rules, inverted-flask. Each is one rule + one
   system check, same as suppress-passive-heal.
6. **Seen-dedup in the relic roller** *(Isaac, [V])* — deferred until the pool
   passes ~50 relics.

(1)–(4) are each small, testable increments on existing seams — none is a
rewrite. Recommended build order as listed.

---

## 5. Authoring rules (the brief for every future relic)

1. **Four-hook rule** (charter, now evidence-backed): a numeric relic must
   stack, belong to a domain, touch a system, or feel great to take — two of
   four for anything above mundane.
2. **EV sanity** (anti-pattern 1): never author a stat that loses to the plain
   damage option at equal rarity without paying for it elsewhere.
3. **Rarity = shape**: mundane numeric / uncommon proc / rare build-shaper /
   cursed rule-with-a-wound. If a mundane rewrites play, it's mis-tiered.
4. **Appliers are scarce** (anti-pattern 4): status-appliers concentrate in
   their affinity domains; most commons don't proc.
5. **Control caps** (anti-pattern 2): chill/stagger/fear stacking is capped or
   hyperbolic, with enemy counterplay authored alongside.
6. **Attention budget** (Axis 1): a relic never demands per-fight tracking.
7. **Zero-attention stacking**: ×N copies must always be strictly-better-N,
   never different-N.
8. **A loop gets a scenario**: any relic touching the substrate ships with a
   headless scenario exercising its machine.
9. **Channels are content**: deal-only and merchant-only relics exist; where a
   relic comes from is part of its design (and its provenance line).
10. **No reroll lever, ever** (anti-pattern 5).

---

## 6. Refuted claims (never repeat these)

From round 1's verification: the Balatro/Luck-be-a-Landlord lineage story
(0-3); "StS boss relics are always pick-1-of-3" (0-3).

---

## 7. The hand-authored pole (round 2, verified) — two opposite scaling laws

### Hades: exhaustive but BOUNDED — the disciplined model

- **[V]** Exactly **28 Duo Boons = C(8,2)** — one per god pair across the 8
  duo-eligible gods, exhaustive coverage with no gaps. Supergiant had **no
  predetermined plan** for full coverage (Rao, on record) — it emerged from
  iteration — but the *structure* is what made it finishable: the budget is a
  closed pair-count, not an open item pool.
- **[V]** Prerequisites are **one-of-a-list from EACH god** ("any of 4
  Aphrodite boons AND either of 2 Ares curses") — flexible gates that fire
  often enough to be *seen*, with a few deliberately narrow exceptions.
- **[V]** The **negative space is authored too**: bespoke exclusion rules
  between duos and against weapon aspects (Freezing Vortex ⊘ Hunting Blades;
  seven duos incompatible with Aspect of Beowulf).
- **[V]** **12 Legendary Boons** are the single-god analogue, gated "N of the
  following" behind 2+ lower boons.
- **[V]** **Pom scaling excludes duos/legendaries entirely** — the
  hand-authored payoff pieces ship at FIXED power; open-ended scaling lives
  only in the emergent substrate underneath (and even there, Pom levels halve
  in value every 2 levels).
- **[V]** Authoring budget: ~50 boon ideas brainstormed → ~15 implemented per
  god; "the game is the design document."

### Gungeon: exhaustive and UNBOUNDED — the cautionary model

- **[V]** ~400 bespoke named synergies (wiki tally; officially "hundreds"),
  structured as exact pairs, one-of-a-list groups, and full sets. The AG&D
  update that added them took **18 months**.
- **[V]** Discovery UX done right: a blue arrow over the player when a synergy
  activates, the synergy NAMED in the pickup popup, synergising items outlined
  in the Ammonomicon. A synergy that fires invisibly doesn't exist.
- **[V]** The scaling ceiling, in the developer's own words (Dave Crooks):
  every new item had to interact with 8 weapon categories + companions +
  bullet modifiers; adding content "slowed to a crawl, and became less fun to
  work on as it became more fragile" — **cited as a factor in ending Gungeon's
  development entirely.**

### The DELVE synthesis (this section is the payoff)

1. **Budget authored synergies against a CLOSED structure, never the open item
   pool.** Hades finished because the budget was C(8,2); Gungeon died because
   the budget was every-item × every-item. Our closed structures: the **9
   domains** (C(9,2)=36 possible domain-pairs — the bridge-card model: The
   Martyr = Valor+Blood) and the **named dead owners** of provenance sets
   (a small cast, each set a handful of pieces). Never author item×item pairs.
2. **Gate on one-of-a-list, and we already own the primitive.** Hades'
   "any N from god A + any M from god B" is structurally our
   `heldDomainCount()` / distinct-piece set thresholds. Domain-pair content
   gates on domain COUNTS, not exact items — it fires often enough to be a
   build, not a lottery ticket.
3. **Authored payoff pieces are FIXED-power.** Like duos being Pom-ineligible:
   set bonuses and any future domain-pair payoffs don't stack-scale — the
   scaling thrill lives in the individual relics underneath. This keeps the
   hand-authored tier balanceable forever.
4. **Author the negative space.** A payoff that must not combine with another
   gets an explicit exclusion, written down, not discovered by a player breaking
   the game.
5. **Name the moment.** Blue-arrow lesson: when a set threshold or resonance
   tier engages, the reveal SAYS so (the pickup toast already appends "Another
   of Vess's things." — extend the same channel to threshold activation).
6. **The one verified celebrated item is a shape we already ship:** RoR2's
   Shaped Glass — a pure symmetric multiplicative trade-off (×2 damage, ½
   health, compounding per stack) — is the canonical "elegant trade-off."
   The Drowned Heart is this shape; the cursed tier should keep mining it,
   including trade-offs that stack BOTH sides.

*Round-2 caveats:* Gungeon counts are wiki tallies, not dev-stated; the
"synergies legible without a wiki" judgment was 2-1 (one reviewer's
impression); no direct Supergiant statement on duo budgeting specifically
exists — the coverage discipline is inferred from verified structure. The
celebrated-items question (which items players crown best-designed, per game)
remains open — worth a future pass or simply our own playtest instincts.

**Primary sources (round 1):** Isaac postmortem (Game Developer, McMillen &
Himsl); LocalThunk on Game Maker's Notebook (Dec 2024) + dev blog; Red Hook
Critsmas patch notes; Dead Cells Update 19 notes; Mega Crit GDC 2019
(metrics-driven balance); RoR2 wiki (items/stacking); StS wiki (relics);
Gungeon wiki (quality tiers); Isaac wiki (item pools, cross-mirror verified).
