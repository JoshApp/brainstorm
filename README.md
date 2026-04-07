# Brainstorm

A space for designing apps through conversation before writing code.

## How It Works

1. **Start** — create `projects/<app-name>/blueprint.md` from the template
2. **Brainstorm** — describe your idea, go back and forth with AI to refine it
3. **The blueprint evolves** — spec gets sharper each session, decisions are logged
4. **Build** — when the spec is clear, the AI codes from it

## The Blueprint

Each project has one living document: `blueprint.md`

**Top half: The Spec** — what we know so far
- Features marked `?` (idea), `~` (shaping), or `✓` (ready to build)
- Decisions with reasoning
- Open questions

**Bottom half: Session Log** — notes from each brainstorm
- What we discussed and decided
- What's still open
- What to tackle next

The spec starts rough and gets precise through conversation. When everything is `✓`, it's ready to build.

## Start a New Project

```
cp blueprint-template.md projects/<app-name>/blueprint.md
```
