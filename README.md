# Brainstorm

A repo for architecting apps before writing code. Instead of jumping straight into implementation, we design the system using structured documents, diagrams, and pseudocode that can later be expanded into real code.

## How It Works

Each project lives in `projects/<project-name>/` and follows a phased approach:

### Phase 1: Define the Problem
- **concept.md** — What are we building and why? Who is it for?
- **domain.md** — Key entities, relationships, and terminology (Domain-Driven Design)

### Phase 2: Architect the System
- **architecture.md** — System diagrams using Mermaid (C4 model: Context, Containers, Components)
- **decisions/** — Architecture Decision Records (ADRs) for key choices
- **data-model.md** — Entities, relationships, and schemas in pseudocode

### Phase 3: Design the Logic
- **flows.md** — User flows and business logic in pseudocode + sequence diagrams
- **api.md** — API surface / interface contracts
- **ui.md** — Screen layouts and component hierarchy (text wireframes)

### Phase 4: Plan the Build
- **build-plan.md** — Ordered implementation steps, dependencies, and milestones
- **stack.md** — Technology choices with rationale

## Why This Works for AI Development

When you hand a well-structured architecture doc to an AI coding assistant, it produces dramatically better code because:
- It understands how pieces connect
- It follows consistent naming from your domain model
- It builds to your actual interfaces, not guessed ones
- Each piece can be generated independently and still fit together

## Techniques Used

| Technique | What It Does |
|---|---|
| **C4 Model** | Architecture at 4 zoom levels (Context > Container > Component > Code) |
| **ADRs** | Capture *why* decisions were made, not just what |
| **Domain-Driven Design** | Map the problem space before the solution space |
| **Mermaid Diagrams** | Text-based diagrams that render on GitHub |
| **Pseudocode-first** | Sketch logic in plain language, then translate to code |

## Getting Started

1. Copy `templates/` into `projects/<your-project-name>/`
2. Start with `concept.md` — describe what you're building
3. Work through each phase, using the templates as guides
4. When ready to code, use the architecture docs as specs for implementation
