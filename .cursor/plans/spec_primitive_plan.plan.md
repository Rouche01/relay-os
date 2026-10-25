---
name: Spec primitive plan
overview: "North star: Specs carry a goal-specific ordered primitive plan (pseudocode procedure) for human Approve/Abort — Spec-owned authority, not a CE AgenticAppManifest clone. CE manifests stay. Optional later: derive a thin runner from the plan."
todos:
  - id: plan-shape
    content: "Add SpecPrimitivePlan types to @relay/protocol (ordered steps: primitive id + goal-specific intent line + optional sideEffect); document vs AgenticAppManifest"
    status: pending
  - id: plan-from-compose
    content: "composeFromPrimitives (+ decide path) emits a goal-specific plan from goal + chosen primitives; persist on Spec or SpecBundle"
    status: pending
  - id: plan-review-ui
    content: "Spec review shows plan as pseudocode procedure (primary surface); keep constraints/HITL/acceptance secondary"
    status: pending
  - id: plan-parity-docs
    content: "Update primitives.md / spec-ui.md — CE-parity = plan steps cover engage-like primitive sequence; hard invariant CE manifests untouched"
    status: pending
isProject: true
---

# Spec primitive plan (goal-specific procedure)

## Do we need a plan?

**Yes — a short one.** The shell compose loop exists; the missing product piece is making Specs **reviewable as procedure**, not as a chip bag. That needs a typed shape, compose emission, UI, and docs — enough for a focused plan, not a rewrite of CommunityEngager.

## North star

```text
Free-form goal
  → decide catalog primitives
  → compose draft Spec
       + ordered primitive plan (goal-specific pseudocode)
  → human Approve / Abort (plan is the primary read)
```

| Is | Is not |
|----|--------|
| Spec-owned **ordered steps**, each a catalog primitive + goal-specific intent line | A full CE `AgenticAppManifest` / stage graph |
| The surface you read before freeze | Inventing unbound stages outside the catalog |
| Parity *target* for engage-like goals (sense → … → wait_human → write) | Replacing `apps/community-engager` manifests |

**Hard invariant:** CommunityEngager manifest runtime stays. This plan is additive.

```mermaid
flowchart LR
  Goal[Goal] --> Decide[decide_primitives]
  Decide --> Compose[composeFromPrimitives]
  Compose --> Spec[Spec_plus_plan]
  Spec --> Review[Pseudocode_review]
  Review --> HITL[Approve_Abort]
  CE[CE_manifests] -.->|untouched| CE
```

## Shape (v0)

```ts
// illustrative
type SpecPlanStep = {
  id: string;                 // stable step id
  primitive: SpecPrimitiveId; // catalog only
  intent: string;             // goal-specific one-liner
  sideEffect?: SideEffectClass;
};

type SpecPrimitivePlan = {
  version: 1;
  steps: SpecPlanStep[];
};
```

Persist on Spec (preferred) or alongside bundle metadata. Compose fills `intent` lines from the goal + primitive role (template / light decide — not free-form stage invention).

## Phases

1. **`plan-shape`** — protocol types + docs (Spec plan ≠ manifest)
2. **`plan-from-compose`** — emit plan in `composeFromPrimitives` / shell create path
3. **`plan-review-ui`** — Spec review primary = pseudocode listing
4. **`plan-parity-docs`** — engage-like acceptance for plan coverage; CE coexistence

## Out of scope

- Rewriting CE stages onto this plan
- LLM inventing non-catalog steps
- Auto-running the plan under a new universal executor (follow-on: derive thin runner *from* plan)

## Done when

- Creating a Spec in the shell yields a **goal-specific ordered plan**
- Review reads like short pseudocode procedure
- CE `run-dev` / demos / deploy unchanged
