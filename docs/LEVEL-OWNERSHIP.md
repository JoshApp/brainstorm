# The level pipeline: what's actually wrong, and what to change

Written 2026-08-04 after Josh: *"the vault and generator and whatever all of the
room building is kinda still doing a lot of legacy we have never fully cleaned…
I don't wanna have a buggy thing like culling at the end. can we instead
reauthor but first think what needs to change. we built too many iterations
without redoing lots of legacy."*

He is right, and this document is the thinking before the reauthoring. It is
deliberately short on plans and long on diagnosis, because the plans are cheap
once the diagnosis is honest.

---

## 1. The measurement

Two numbers say the whole thing.

**Seven files put objects into a floor. One of them uses the occupancy grid.**

```
vault-compose.ts     22 placement sites   uses the grid
clutter.ts            6                   does not
builder.ts            6                   does not
tilemap.ts            5                   does not
centrepieces.ts       5                   does not
decor-pass.ts         3                   does not
loot-director.ts      1                   does not
```

`occupancy-grid.ts` — the module whose entire job is to answer "what is in this
cell, and may I put something here" — is imported by exactly one consumer. The
other twenty-six placement sites decide for themselves, each with its own idea of
"free": a distance check against a list it happens to hold, a room rect, a tile
character, or nothing at all.

**10.3% of placed objects on a depth-3 floor sit inside a carved void**, and
another 9.8% sit on its lip. That is Josh's "the basin is standing like almost in
the void or slightly over it", and it is not a rare seed — it is one thing in
five near a chasm. (Depth 3 is the worst band, and it got worse *today*: widening
the early vault pool moved the void-carrying vaults down to depth 2. A fix in one
place made a latent bug in another place fire more often, which is itself the
symptom this document is about.)

---

## 2. The diagnosis

It is not the ASCII vaults, and it is not that any individual pass is badly
written. Most of them are good. The problem is structural and has one sentence:

> **No pass owns the floor. Every pass owns its own idea of the floor, and they
> are reconciled by running them in a lucky order.**

Three consequences, all of which we have now hit repeatedly:

**a) Constraints have to be re-enforced at the end, forever.** A rule like "a
shop has no enemies" or "a room has one major beat" or "a trove has a clean
floor" cannot be stated once, because the six blind producers will each violate
it independently. So each rule grows a cull that runs after everything and undoes
the damage. There are three such sweeps in `vault-compose.ts` today and I added
one of them this session. Josh's instinct — *"culling at the end is kinda a buggy
thing isn't it"* — is exactly right, and here's why it's more than aesthetic: a
cull can only DELETE. It cannot put the thing somewhere better. When the peaceful
-room cull deleted enemies from shops, the floor dropped below its combat
minimum and the invariants caught it; the cull had to move earlier so the budget
could re-place them. Every cull has that failure mode latent in it, and the next
one won't have a test waiting.

**b) Ordering is load-bearing and undocumented.** The elbow-room sweep does
nothing unless it runs after both clutter passes. The engraved-room swap has to
read the torch tint before the torches are deleted. The peaceful cull has to run
before the combat budget. None of this is expressed anywhere except the order of
statements in a 2,500-line function, so every new pass is a coin flip.

**c) A fix in one place fires a bug in another.** See the void number above.
Passes that share no contract share no safety.

### Why the ASCII vaults are NOT the problem

Worth stating plainly, because it was Josh's question and the answer is a
recommendation to KEEP them.

An ASCII tilemap is a genuinely good authoring format for this project. It is
legible to a human at a glance, diffable, and — the part that matters most given
CLAUDE.md's authoring model — it is the format an LLM content layer can write
correctly without reading any implementation. That is precisely the "code as an
interface between layers" property we want. Replacing it with a graph, a node
editor or a constraint solver would buy expressiveness we have not yet run out
of, and cost the thing that makes the content layer possible.

What we HAVE outgrown is the tilemap being a **direct source of world objects**.
Today an `X` in a map becomes an enemy, immediately, at parse time, before anyone
knows whether this room ended up a shop. That is why a promoted shop kept its
vault's monsters through three separate gates. The tilemap should declare
**intent** — *this cell is a combat slot, this is a feature slot, this is
floor* — and one authority should resolve intent into objects once the room's job
is known.

So: keep the format, change what it produces.

---

## 3. What to change

The shape of the fix is one idea, applied in stages. **Nothing here requires
rewriting procgen**; the vault library, the corridor router, the floor plan and
the room-type table are all fine and stay.

### The one idea: a placement authority that everything goes through

One object per floor owns the answer to "what is at this cell and may I put
something here". It knows about walls, voids, elevation, reserved approaches, the
room each cell belongs to, and that room's TYPE. Every producer asks it, and it
is the only thing that can say yes.

```
claim(cell, { kind, needs: 'floor' | 'wall' | 'approach', for: roomId }) → ok | why-not
```

The moment that exists, the three consequences above dissolve:

- A rule is enforced **once, at the claim**, not re-enforced by a cull. "A shop
  has no enemies" becomes the authority refusing an enemy claim in a shop room.
  A refusal is also *informative* — the producer can place it elsewhere, which a
  cull can never do.
- Ordering stops being load-bearing for CORRECTNESS. It still matters for
  quality (you want the centrepiece to claim before the clutter), but a pass that
  runs in the wrong order now gets refusals instead of producing a broken floor.
- A void carved into the grid makes every subsequent claim over it fail, for all
  six producers at once, without any of them knowing voids exist.

### Staging (each step is shippable and independently verifiable)

1. **Make the grid authoritative for VOIDS and WALLS.** The smallest step with
   the biggest measurable win: route the six blind producers' final positions
   through a `canPlaceAt` check. This is still a filter, not yet an authority —
   but it takes the 10.3%-in-a-void number to zero and proves the seam.
2. **Give the grid the ROOM TYPE.** Then the shop/trove/clean rules move from
   three culls into one refusal, and the culls come out. Measured by deleting the
   sweeps and watching the existing tests stay green.
3. **Tilemap declares intent, not objects.** `X` becomes a combat SLOT that the
   authority fills after roles are assigned. This is the step that makes
   promotion safe by construction, and it is where the legacy actually lives.
4. **Delete the reconcile/cull passes** that are then provably unreachable, and
   write the ordering that remains into this document as a contract rather than
   leaving it implicit in statement order.

### What to explicitly NOT do

- Do not rewrite the vault library or the ASCII format.
- Do not build a constraint solver. The failure is missing ownership, not
  insufficient cleverness, and a solver would make the floor harder to author and
  harder to debug.
- Do not do all four stages in one change. Stage 1 alone is worth shipping and
  each stage has a number attached to it.

---

## 4. The rule this leaves behind

DESIGN-METHOD §3 says *check a final-state rule against the final state*, and
that was the right lesson from the trove and the shared bonfire. This document
adds the other half of it, learned by over-applying the first:

> **A final-state check is how you VERIFY a rule, not how you IMPLEMENT one.**
> If the only thing enforcing a constraint is a sweep at the end, the constraint
> has no owner — and a sweep can only delete, never place. Put the rule at the
> point of claim; keep the final-state check as the test that proves it held.
