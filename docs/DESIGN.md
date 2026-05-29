# DELVE — Design Philosophy

This is the **why** layer. `CLAUDE.md` covers what's built and how we
work; this covers what makes the game good and the principles we hold
when deciding what to build. Read it when a design call is ambiguous.

Format note: this is markdown on purpose — it's working canon, read and
edited every session and diffed in commits. Show-and-look artifacts
(vision one-pager, landing page, public changelog) are better as
self-contained HTML; this is not one of those.

---

## What makes a dungeon crawler fun (the engine)

A crawler is **a machine for meaningful decisions under uncertainty,
with stakes that escalate as you descend.** Every fun moment is one of
these firing:

1. **The unknown.** The unopened door, the unidentified item, the dark
   ahead. Curiosity is the cheapest strong motivator there is.
2. **Escalating investment.** Deeper = more sunk in, more to lose.
   Depth *is* the stakes curve — that's why "going deeper is the
   progression" is load-bearing, not arbitrary.
3. **Meaningful gambles.** Drink the fountain? Take the cursed
   blood-altar item? Push one more floor or bank it? The player owns
   the outcome, not the dice.
4. **Legible mastery.** You get better at the *verbs* — spacing,
   timing, target priority — and you can feel it. Power from skill,
   not only from loot.
5. **Tension/release rhythm.** Danger, then the safe room. The bonfire
   only feels good because the dark was scary.

DELVE has a lever on all five. Protect them.

---

## The mobile thesis

The great mobile crawler mostly doesn't exist because the genre's
instincts are PC/console — long sessions, precise controls, dense
systems — and people *port* that onto a phone instead of *designing
for* it. DELVE's bet is to design mobile-first from the session length
up. Concretely:

- **The floor is the session unit (~2–4 min).** A floor should be a
  complete, satisfying beat. Someone playing on a commute finishes a
  floor, not a run.
- **Never punish interruption.** Backgrounding the app, a phone call,
  a closed tab — none of it should cost a run. Resumability is a
  feature, not a nicety.
- **One-thumb, committed combat.** The player never aims, they
  *commit*. Auto-target + cone swing + tap-target. The skill is
  timing and positioning, never dexterity-aiming around an occluding
  thumb.
- **Async social IS the multiplayer.** Bloodstains, messages, phantom
  corpses, the depth leaderboard. This sidesteps real-time netcode —
  the genre's hardest mobile problem — and is *more* suited to mobile
  than to console. (Phase 4.)
- **Grimdark is the wedge.** The store is a sea of bright and cute.
  Looking like nothing else in the category is a distribution
  advantage. Never dilute it.
- **The narrator makes runs shareable.** A grim epitaph + a snarky
  achievement on a dumb death is a screenshot you send a friend.
  Organic distribution baked into the content layer. (Phase 5.)

One sentence: **deliver "meaningful choices under rising stakes" in
3-minute, one-thumb, atmospherically distinct, socially-haunted bursts
that PC-brained crawlers can't.**

---

## Principles we hold

- **Every enemy teaches a different verb.** Stoneguard teaches
  *timing*. Ooze teaches *AoE / positioning*. Acid-spitter teaches
  *closing distance*. When adding an enemy, answer "what does this one
  make the player do differently?" If the answer is "nothing new," it
  doesn't earn a slot — it's just more HP to chew through.
- **Legible risk.** The player must be able to *see* danger and choose
  to engage. Fair-but-brutal (the death you'll replay and avoid) is
  good. Unfair (the death you couldn't read) is rage, not learning.
- **Every floor needs a high point.** A valid floor is not the same as
  a memorable one. A signature room, a set-piece, a "you'll remember
  this." Procgen correctness is the floor; memorability is the goal.
- **Variety from systems, not volume.** Slay the Spire has ~75 cards
  and infinite runs because they *combine*. Reach for emergent
  combinations before more content.
- **The first 90 seconds must hook.** Mobile bounce is brutal. Get the
  player swinging at something within seconds. Protect the
  starter-weapon-choice cold open.
- **Lighting is signal, not decoration.** (See CLAUDE.md.) An uncommon
  light source means something is *there*.
- **Combat feel is the foundation.** (Pillar #1.) If it doesn't feel
  good in the hand with nothing else on screen, nothing else matters.

---

## Where crawlers suck — the anti-checklist

Run new work against this. If a change moves us *toward* any of these,
reconsider.

- **Filler.** Trash mobs, samey corridors, backtracking. Procgen makes
  this worse by default — "infinite, but identical."
- **Mash combat.** If optimal play is "tap fastest," there's no
  decision, just labor.
- **Opaque systems.** Hidden formulas, stats you can't reason about.
  Can't make a meaningful choice about a system you can't see.
- **Inventory friction.** Sorting bags, tooltip-comparing. Death by a
  thousand taps — especially brutal on a phone. Auto-equip-if-better,
  one-glance stat deltas, no sorting chores.
- **The slow ramp.** An hour to get good or to reach the fun. Fatal on
  mobile.
- **Stakeless meta** (you always win by grinding) **or time-wasting
  permadeath** (a 40-min run lost to one cheap hit).
- **Lore walls.** Paragraphs nobody reads. Imply the world; don't
  lecture it.

---

## Open bets / next frontiers

Not committed — the live discussion list. Combat feel is the
foundation and is largely in place; these are the next leverage areas.

- **Floor memorability pass.** Signature set-piece vaults; the
  god-ray-anchors-content rule applied harder; each floor guaranteed a
  high point.
- **Enemy-verb audit.** Walk the current roster against "what does
  this one teach?" — find gaps and overlaps.
- **Session-as-floor pacing + resumability.** Make a floor a complete
  beat and an interrupted run safe.
- **Phase 4 (async social) as the retention engine.** The depth
  leaderboard is the between-session hook.
- **Phase 5 (LLM narrator) for personality + shareability.** Epitaphs,
  item discovery, achievement snark — the build-in-public fuel.
