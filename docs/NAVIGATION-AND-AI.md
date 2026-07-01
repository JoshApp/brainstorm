# Navigation & Agent AI — reference

Deep-dive on how agent movement *should* work in a game like DELVE, where we
are today, what's causing the bugs we've hit (doorframe clipping, coarse grid,
left-right stalls), and how the playtest **bot** becomes the seed for the
smart, Dark-Souls-cunning **enemies** we want later.

Grounded in the actual code: `src/level/nav-grid.ts` (the A* grid),
`src/level/walkable.ts` (collision truth), `src/harness/bot.ts` +
`src/harness/pathfind.ts` (the bot), `src/mobs/enemy.ts` (mob steering).

---

## 1. The standard navigation stack — five layers

Every robust game navigator is a *pipeline*, not one algorithm. Bugs almost
always live in a specific layer, so it's worth naming them:

1. **Representation** — how the walkable world is encoded for search.
   - **Grid** (what we use): uniform cells, trivial to build/update, but a
     fixed resolution can't see sub-cell gaps (→ doorframes), and center-to-
     center paths are blocky.
   - **NavMesh** (polygons over walkable area): far fewer nodes → faster
     search, and it encodes *corridors* that make smoothing exact. The
     industry default for exactly our kind of tight indoor geometry.
2. **Global pathfinding** — A* / Dijkstra over the representation. Finds *a*
   route, cell-to-cell. On grids it's blocky and has more waypoints than
   needed.
3. **Path smoothing / string-pulling** — pull the blocky path taut inside its
   corridor so it reads as a straight line a human would walk. The **funnel
   algorithm** ("simple stupid funnel") is the canonical one; **Theta\***
   (any-angle A*) bakes smoothing *into* the search (≈13% shorter, far fewer
   waypoints, no separate pass).
4. **Path following** — turn waypoints into motion: **arrival** (slow into the
   goal), **lookahead** (aim at a point a bit *ahead* on the path so turns are
   anticipated, not reacted to), speed by curvature. This is where "robotic vs
   human" is won or lost.
5. **Local avoidance** — dodge *other agents* in real time (**RVO/ORCA**):
   pick a velocity close to desired that won't collide. Only matters with
   crowds/packs.

Key principle from the literature: **global (A*) + local (steering/avoidance)
are separate concerns.** The path says *where*; steering says *how to move
along it right now*. Conflating them is the usual source of jitter.

---

## 2. Where DELVE sits today

| Layer | DELVE | Notes |
|---|---|---|
| Representation | **Grid** `NavGrid`, 0.5m cells, tiers FULL/TIGHT/GATE/BLOCKED, built from `WalkableRegion` (rects − walls − obstacles), live-rebuilt on version change | Good: collision-truth-sourced (no drift), doorway TIGHT tier + `NavGate` bands for framed openings |
| Global | **A\*** 8-way, octile heuristic, tight-cell cost penalty | Solid |
| Smoothing | **Partial funnel** — pulls the path to *gate centres* + (new) a pre-gate alignment point. NOT full string-pulling | This is the gap behind most path-quality bugs |
| Following (mobs) | steer toward next waypoint, pop when <0.35m, sidestep when pinned | Continuous — decent |
| Following (bot) | **discrete `Direction8`** move toward a lookahead waypoint | The 8-way quantization is a real limiter (see below) |
| Local avoidance | **none** (clampMove wall-slide only) | Fine for now; needed when packs crowd a doorway |

---

## 3. The bugs we hit, mapped to the stack

- **Sharp-angle archway clip (bot *and* mobs)** → *smoothing + following*.
  Center-to-center A* + funnel-only-at-gates produces paths that cut
  diagonally into an opening. The funnel-through-gate-centres helped; the
  new **pre-gate alignment point** (approach square-on) helps more. The
  *complete* fix is **full string-pulling** (funnel the whole corridor) or
  **Theta\*** so the path is taut everywhere, not just at gates.
- **"Doorframe too thin / not in the grid"** → *representation resolution*.
  A 0.5m grid literally cannot represent a gap narrower than its pitch; a
  frame post between sample points is invisible. Mitigations already in:
  the **TIGHT** tier (0.24m clearance guarantee for 1m doorways) and
  **`NavGate`** bands (guaranteed-passable strips the sampling can't see).
  The real ceiling-raiser is a **navmesh** (exact geometry, no sampling).
- **Left-right stall in a hallway** → *following*. Discrete `Direction8`
  explore picked "most open," and a straight corridor's two ends tie → tiny
  raycast noise flip-flops the pick → oscillate in place. **Fixed** with
  heading **hysteresis** (commit to a direction while it stays open).
- **Blocky headings generally** → *following*. `Direction8` throws away the
  lateral component of a heading (a "mostly-N, slightly-E" waypoint rounds to
  pure N), so the bot drifts off the smoothed line. Continuous steering
  removes this entirely.

---

## 4. Recommendations (prioritised)

**Near-term (path quality, low risk):**
- **A. Full string-pulling.** Extend `funnel()` from gates-only to the whole
  path (classic simple-stupid-funnel over the cell corridor). Biggest single
  win for "stops looking robotic / stops clipping."
- **B. Continuous steering for the bot.** The bot is stuck with `Direction8`
  because the harness action vocabulary is discrete. Add a `steer(toPoint)`
  action (set `moveX/moveY` toward a world point, not an 8-dir) so the bot
  follows the smoothed path exactly — kills the quantization *and* the
  oscillation class of bugs. Mobs already steer continuously.
- **C. Lookahead + arrival** in path following (aim slightly ahead on the
  path; decelerate into the goal) — the standard anti-corner-cut, anti-
  overshoot pair.

**Medium-term (raise the ceiling):**
- **D. Evaluate a NavMesh** for the dungeon. Tight indoor geometry with
  doorways is the textbook navmesh case: exact corridors → exact funnel, no
  sampling-resolution failures, cheaper search. Big lift, but it retires the
  whole "grid too coarse" bug family.
- **E. Local avoidance (RVO/ORCA)** once packs crowd — so three mobs don't
  jam a doorway. Layer it *under* the path follower (adjust the desired
  velocity), never replace pathing with it.

**Keep:** collision-sourced cells (no drift), tiers + gates, live rebuild.

---

## 5. The bot as the seed for smart, player-like enemies

The most important architectural idea for where we're going: **separate
NAVIGATION from DECISION.**

- **Navigation** (this whole doc so far) = *how to move*. Low-level, shared,
  identical for the bot and every enemy. `NavGrid` + steering + avoidance.
- **Decision / behaviour** = *what to do* (approach? bait? circle? retreat to
  a doorway? wait for an opening?). This is the "brain" — and it's what makes
  an enemy read as *cunning*.

`bot.ts step()` is already a **decision policy** — a hand-written priority
list (fight in reach → loot → descend → explore) reading a clean
**perception API** (`harness/observation.ts`). That is exactly the seed. The
path to smart enemies is to **grow the decision layer** while keeping the same
nav + perception substrate underneath:

- **Behavior Trees** — structured, debuggable, designer-authorable. Good
  default for readable enemy logic.
- **Utility AI** — score candidate actions by context and pick the best.
  Excellent for "cunning" reactive choices (when is baiting better than
  committing?), and it degrades gracefully.
- **GOAP** — the AI plans a *sequence* of actions to reach a goal. This is
  what F.E.A.R.'s soldiers used to feel genuinely tactical (flank, suppress,
  reposition) — the closest fit to "Dark-Souls-cunning, player-like."
- **Hybrid (modern norm):** utility picks the goal/priority, a BT or GOAP
  plan executes it, perception feeds both.

**Concrete direction for DELVE:**
1. Treat `harness/observation.ts` as the canonical **perception** interface
   for *all* agents (bot and enemy) — one world-sensing API.
2. Treat the NavGrid + a (future) continuous steerer as the shared
   **navigation** service both call.
3. Make the **decision layer pluggable**: the bot ships a simple policy
   (coverage/playtest); an enemy ships a richer one (utility/BT/GOAP) for
   cunning — same inputs, same movement, different brain.
4. This is *also* why the bot is worth investing in now: every nav/perception
   fix we make for the playtest bot is a fix the enemy AI inherits for free.

The line to hold: **share the substrate (perception + navigation), swap the
brain.** Don't let combat smarts leak into the pathfinder, and don't let the
pathfinder's quirks dictate behaviour.

---

## Sources

- [Pathfinding in Video Games: A*, Dijkstra and NavMesh (UDIT)](https://www.udit.es/en/pathfinding-en-videojuegos-a-a-estrella-dijkstra-y-navmesh-con-ejemplos-paso-a-paso/)
- [Simple Stupid Funnel Algorithm (Digesting Duck)](http://digestingduck.blogspot.com/2010/03/simple-stupid-funnel-algorithm.html)
- [This Path Was Made For Walking — funnel/string-pulling (Martin Evans)](https://martindevans.me/heist-game/2015/04/23/This-Path-Was-Made-For-Walking/)
- [Theta\* for Any-Angle Pathfinding (Game AI Pro)](https://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter16_Theta_Star_for_Any-Angle_Pathfinding.pdf)
- [Theta\*: Any-Angle Path Planning on Grids (arXiv)](https://arxiv.org/pdf/1401.3843)
- [Any-angle path planning (Wikipedia)](https://en.wikipedia.org/wiki/Any-angle_path_planning)
- [Steering Behaviors — path following, arrival, lookahead (libgdx gdx-ai)](https://github.com/libgdx/gdx-ai/wiki/Steering-Behaviors)
- [Unity — Inner Workings of the Navigation System (global path + local RVO)](https://docs.unity3d.com/520/Documentation/Manual/nav-InnerWorkings.html)
- [Collision Avoidance: VO vs RVO vs ORCA](https://blog.singsongaftermath.com/daily-knowledge/vo-rvo-orca/)
- [A* Pathfinding Project — Local Avoidance](https://arongranberg.com/astar/documentation/beta/localavoidance.html)
- [Game AI Planning: GOAP, Utility, and Behavior Trees (Tono)](https://tonogameconsultants.com/game-ai-planning/)
- [GOBT: Goal-Oriented + Utility planning in Behavior Trees (JMIS)](https://www.jmis.org/archive/view_article_pubreader?pid=jmis-10-4-321)
</content>
