---
name: Capability slots + binding alternatives
overview: "Medium-term. Scaffold binds Intent to capability slots (placeholders), not a single brittle service id. Desk ranks binding alternatives (API / MCP / notify / computer / human); Ship resolves one connection. Fixes the CE Reddit failure mode without rewriting Specs when the first vendor API dies."
todos:
  - id: cs0-thesis
    content: Lock thesis — Spec names capability slots; candidates are ranked alternatives; resolved binding is install-time; Spec law stays stable when binding swaps
    status: completed
  - id: cs1-slot-model
    content: Define CapabilitySlot / BindingCandidate types (id, ops needed, candidates[{service, binding, status, reason}], resolved connection ref) + small capability vocabulary seed (e.g. reddit.read, youtube.discover, scm.issues)
    status: completed
  - id: cs2-scaffold-emit
    content: Scaffold emits unresolved slots + candidates from intent (not hard-coded single service); Needs[] only when no candidates exist at all
    status: pending
  - id: cs3-ship-resolve
    content: Ship / Connections UX — pick or accept top live candidate; never silent degraded; mark ready on resolved connection; shadow before irreversible writes
    status: pending
  - id: cs4-runtime-resolve
    content: Host resolves slot → binding at run time from install state; swap binding without re-scaffolding Spec
    status: pending
  - id: cs5-dogfood
    content: Dogfood — Reddit-style or YouTube-style intent scaffolds with slots + alternatives (official / degraded / computer / human); operator picks without Spec rewrite
    status: pending
  - id: cs6-docs-link
    content: Document CE lesson + link from open-services plan; GUIDE note that ASAP still uses concrete catalog services until this lands
    status: pending
isProject: true
---

# Capability slots + binding alternatives (medium-term)

Sibling of long-term [`relay_open_services_platform.plan.md`](./relay_open_services_platform.plan.md), medium-term [`relay_app_knowledge_mcp.plan.md`](./relay_app_knowledge_mcp.plan.md), and completed short-term [`relay_desk_closed_loop_asap.plan.md`](./relay_desk_closed_loop_asap.plan.md). Does **not** reopen ASAP success criteria.

## Thesis (locked — cs0, 2026-11-07)

Today scaffold often locks a **concrete service** on Create draft. When that API is blocked (CE → official Reddit → redditapis after many failures), the Spec itself becomes wrong.

Elevate to:

> **Intent names what must be done (capability). Binding names how — and can change without rewriting the brief.**

```text
Intent
  → Spec with capability slots (placeholders)
  → candidates[] ranked by availability
  → Ship resolves one binding + connection
  → run uses resolved binding (swappable later)
```

### Non-negotiables

| # | Lock |
|---|------|
| 1 | **Spec law** = goal, rules, HITL, steps, and **slot ids**. Changing vendor/API must not require rewriting that law. |
| 2 | **Slot** = named capability the run needs (`reddit.read`, `youtube.discover`, …). Stable across binding swaps. |
| 3 | **Candidates** = ranked alternatives for a slot (service + binding kind + honest status). Scaffold proposes; it does not silently pick degraded as “live”. |
| 4 | **Resolved binding** = install-time (Ship / Connections), not Create-draft-final. Draft may suggest a preferred candidate; operator confirms before live. |
| 5 | **Needs[]** = only when a required slot has **zero** viable candidates. Partial catalog → show alternatives, don’t invent fake ops. |
| 6 | **ASAP unchanged** until types + scaffold emit ship — GitHub triage stays concrete `github` / `github:default`. |

### What lives where

| Concern | Home |
|---------|------|
| Capability required | Spec slot (frozen with Spec) |
| How we might do it | Candidate list (may refresh as catalog/status changes) |
| How this Desk install does it | Resolved connection / binding on the installed app |
| Secrets | Connection store — never in Spec |

### CE failure mode (explicit)

Community Engager’s Reddit path failed by baking one service into the product loop. The recovery (redditapis / notify / browser thoughts) was a **binding change**. This plan makes that the default product shape: try official → degraded → computer → human as **candidates on one slot**, not successive Spec rewrites.

## Why this exists

| Without slots | With slots |
| --- | --- |
| First scaffold guesses `reddit-oauth` | Slot `reddit.read` + candidates (oauth, redditapis, browser, human) |
| Vendor blocked → rewrite Spec | Swap candidate; Spec law unchanged |
| Needs[] is only fail-closed | Needs[] only when **zero** candidates; otherwise choose |

## Architecture

Types + seed live in [`packages/protocol/src/capability-slots.ts`](../../packages/protocol/src/capability-slots.ts) (`CapabilitySlot`, `BindingCandidate`, `CAPABILITY_VOCAB_SEED`). **Not** wired into `SpecV2Body` yet — that is `cs2` (scaffold emit). ASAP Specs stay concrete `services` / `connections`.

```text
Spec (future slots[])
  - id: youtube.discover
    needs: [...]
    candidates: [{ service, binding, status, reason, rank? }, ...]
    resolved: null | connectionRef
    preferredCandidateIndex?: number
```

- **Slot** = capability required by the Spec (stable).
- **Candidate** = one way to satisfy it (ranked; honest status).
- **Resolved** = what this install will use (Ship / Connections).
- Steps reference the **slot** (or resolved ref), not a frozen vendor forever.

## In scope

1. Types + small capability vocabulary seed.
2. Scaffold emits slots + candidates from intent + catalog + connection state.
3. Desk Ship/Connections: pick candidate, mark ready, surface degraded explicitly.
4. Runtime resolves slot → binding for runs / shadow.
5. One dogfood intent that would have failed CE-style (Reddit or YouTube discover).

## Out of scope

- Full open-services “add any service from words” rail (see open-services plan)
- Auto-picking degraded bindings without operator visibility
- Knowledge store / outbound app MCP (knowledge plan)
- Replacing ASAP GitHub triage dogfood as the closed-loop bar

## Locked choices

| Choice | Decision |
| --- | --- |
| Spec center | Capability slots, not first-guess service ids |
| When checked | Create draft proposes candidates; Ship confirms resolution |
| Degraded | Allowed as candidate; must be labeled; never silent default to live-looking |
| Swap | Change resolved binding without re-scaffold |
| ASAP | Remains concrete catalog services until this ships |
| Thesis | Locked `cs0` (2026-11-07) — see Non-negotiables above |

## Success criteria

1. Scaffold for a multi-binding domain emits ≥1 slot with ≥2 candidates (or honest Needs if none).
2. Operator can resolve a different candidate post-scaffold without rewriting goal/rules/steps structure.
3. Docs state CE lesson: bindings change; Spec + HITL should not.

## Suggested sequencing

1. ~~`cs0` thesis~~ · ~~`cs1` types + vocabulary~~  
2. `cs2` — scaffold emit  
3. `cs3` — Ship resolve UX  
4. `cs4` — runtime resolve  
5. `cs5` — dogfood  
6. `cs6` — docs / cross-links  

### `cs0` done (2026-11-07)

- Thesis + non-negotiables locked in this plan.

### `cs1` done (2026-11-07)

- `@relay/protocol` — `CapabilitySlot` / `BindingCandidate` / vocab seed (`scm.issues`, `reddit.read`, `youtube.discover`, `slack.notify`, `notion.store`, `http.fetch`) + shape helpers + tests.
- Next: `cs2` — scaffold emits slots + candidates; optional `SpecV2Body.slots`.

## Links

- Open services (bindings, Services rail): [`relay_open_services_platform.plan.md`](./relay_open_services_platform.plan.md)  
- ASAP closed loop (done): [`relay_desk_closed_loop_asap.plan.md`](./relay_desk_closed_loop_asap.plan.md)  
- Knowledge / Creatuuls dogfood: [`relay_app_knowledge_mcp.plan.md`](./relay_app_knowledge_mcp.plan.md)  
- CE Reddit lesson: open-services § Lessons + [`notify_only_redditapis_scout.plan.md`](./notify_only_redditapis_scout.plan.md)  
