# Architecture

## System Context (C4 Level 1)
<!-- Who uses the system and what external systems does it interact with? -->

```mermaid
graph TB
    User[User/Actor] --> System[Our System]
    System --> ExtService[External Service]
```

## Containers (C4 Level 2)
<!-- What are the major deployable units? (frontend, backend, database, etc.) -->

```mermaid
graph TB
    subgraph System
        Frontend[Frontend App]
        Backend[API Server]
        DB[(Database)]
        Frontend --> Backend
        Backend --> DB
    end
```

## Components (C4 Level 3)
<!-- For each container, what are the major structural pieces? -->

### [Container Name]

```mermaid
graph TB
    subgraph ContainerName
        ComponentA[Component A] --> ComponentB[Component B]
        ComponentB --> ComponentC[Component C]
    end
```

## Infrastructure
<!-- How is this deployed? -->

```
[Describe hosting, CI/CD, environments]
```

## Key Constraints
<!-- Technical constraints, budget, timeline, team size -->
