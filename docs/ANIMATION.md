# Animation tooling

A **living design thread** (2026-06-06). Direction, not settled canon —
tagged `[BUILT]` / `[LEANING]` / `[DEFERRED]`. Companion to COMBAT-ARCH.md.

## The decision [LEANING]

After a research pass (libraries, formats, AI motion-gen), the call for a
**code-generated, no-glTF, primitive-rig, LLM-authored, mobile** game is:
**build a small engine, not adopt a framework.** Concretely:

1. **Authored motion = a small semantic keyframe DSL** — channels keyed by
   `node.prop.axis` (`blade.rot.x`), matching the model's slot/part names.
   LLM- and human-authorable, diffable, ~0KB runtime. *This is the unifying
   format for what are today three separate systems* (`pose-clips`,
   `weapon-pose-spec`, `BodyAnimator`).
2. **Procedural life = hand-rolled spring-damper + additive pose layers.**
   The single highest feel-per-line lever (sway, lag, follow-through,
   telegraph weight); additive layers = base loco pose + spring-weighted
   telegraph/aim/flinch deltas. Zero deps.
3. **three.js's built-in `AnimationMixer` is available as a free playback /
   blending engine** where crossfade + time-scale matter (mob locomotion,
   combo-state transitions) — it binds to plain `Object3D`s by `.name`, no
   glTF/skeleton needed, and clips build from plain arrays. Adopt it in the
   migration phase where blending earns it; the custom sampler covers the
   rest.

**Rejected:** Theatre.js as a runtime (great dev editor, but its `state.json`
is opaque/ID-keyed — wrong as the *authored* format; revisit only as a
dev-only visual editor + exporter). GSAP/Motion/anime (own their clock →
fight hit-pause/slow-mo; only `@tweenjs/tween.js` is dt-driven, optional).
IK libraries (need a skeletal mesh or unmaintained). **AI motion-generation
models** (MDM/MotionGPT/MoMask) — they emit *human skeletal mocap* (SMPL),
the wrong shape for a primitive rig, with non-commercial licenses. The
research (incl. Apple's "Keyframer") confirms the real leverage is **good
data schemas + a fast render-feedback loop** (the bench) where the LLM
authors and tunes structured keyframe/timing data — not a motion model.

## What's built [BUILT]

`src/anim/` — pure core, fully unit-tested (`tests/anim.test.ts`), inert
until wired:

- `easing.ts` — named eases (`easeOutBack`, …); author a curve by name.
- `spring.ts` — `damp` (frame-rate-independent exact decay), `spring`
  (2nd-order: critical = no overshoot, under-damped = follow-through),
  `dampVec3`/`dampQuat`.
- `keyframes.ts` — the DSL (`ClipSpec` / `Track` / `Keyframe`) + pure
  `sampleTrack` / `sampleClip` / `clipDuration`.
- `pose-layers.ts` — `blendAdditive(base, layers)` (weighted delta layers).
- `apply.ts` — writes a sample onto the rig's named `Object3D`s (the only
  THREE-touching piece).

## What's deferred [DEFERRED — needs a live preview session]

The **migration + live wiring** is mechanical but changes TUNED combat feel,
so it waits for a working dev server (the bench is the only animation preview
and it's been down):

- Drive the weapon viewmodel from clip specs (migrate `weapon-pose-spec` /
  `computeWeaponPose`), add spring-based sway/lag on top.
- Express mob telegraphs (`pose-clips`) + locomotion (`BodyAnimator`) as
  clips + additive layers; adopt the mixer for loco crossfade.
- Author the moveset library as data; iterate via the bench `--anim` loop.

Do this in a session that can render, so feel doesn't regress unseen.

## Sources
- [three.js AnimationMixer / KeyframeTrack / PropertyBinding](https://github.com/mrdoob/three.js/blob/dev/src/animation/PropertyBinding.js)
- [Spring-It-On — Daniel Holden](https://theorangeduck.com/page/spring-roll-call) · [Damped Springs — Ryan Juckett](https://www.ryanjuckett.com/damped-springs/)
- [Theatre.js core/studio](https://www.theatrejs.com/docs/latest/manual/projects) · [tween.js](https://github.com/tweenjs/tween.js/)
- [Keyframer — Apple](https://machinelearning.apple.com/research/keyframer) · [MotionGPT](https://motion-gpt.github.io/)
