# Spec primitives & compose (sketch)

**Status:** design sketch (Phase E). No runtime rewrite yet.  
**Plan:** [`.cursor/plans/relay_intent_spec_verify_hitl.plan.md`](../.cursor/plans/relay_intent_spec_verify_hitl.plan.md) — `primitive-catalog-sketch`, `compose-compiler-direction`.

**Goal:** Almost any Intent becomes a Spec by **mixing domain-free primitives**, not by shipping a new compiler per app. Domain packs (e.g. CommunityEngager `engage`) are optional recipes that expand into the same primitives.

Related: [`spec.md`](./spec.md) (types + engage dogfood), [`viability.md`](./viability.md).

---

## Layers

| Layer | Role |
|-------|------|
| **Primitives** | Spec-addressable atoms the host can actually run |
| **Composition** | Intent → select / order / constrain primitives → draft Spec |
| **Domain packs** | Named recipes that expand to primitives (shortcuts, not catalog roots) |

Today’s [`engage-compiler`](../apps/community-engager/src/spec/engage-compiler.ts) is a **domain pack**. It remains valid dogfood. It is not the end architecture.

---

## Primitive catalog (v0)

Keep the set **small**. Every id below is a candidate `SpecAllowedAction.id` (or a stable prefix). Engines bind each primitive via `actionBinding`: `protocol` preferred, `browser` fallback.

| Id | Purpose | Default `sideEffect` | Notes |
|----|---------|----------------------|--------|
| `observe` | Read world state without changing it | `none` | DOM snapshot, API GET, memory recall, list resources |
| `invoke` | Call a Spec-shaped capability / tool | `reversible` or `irreversible` | Prefer protocol; side-effect declared per capability |
| `read` | Fetch a specific artifact or record | `none` | Files, URLs, store rows — no mutate |
| `write` | Create or mutate an external artifact | `irreversible` | Posts, emails, DB writes, file overwrite |
| `navigate` | Move focus / context (URL, app surface) | `none` | Browser path; no-op or soft under protocol |
| `wait_human` | Block for Approve / Edit / Abort | `none` | HITL surface (CLI / Telegram / later UI) |
| `assert` | Check an acceptance / evidence item | `none` | Feeds evidence pack; fail closed when Spec requires |

### Irreversibility

- Anything that can leave durable external effects defaults to `write` or `invoke` with `sideEffect: irreversible`.
- Spec `hitlRequired` must include a `before_irreversible` (or equivalent) when any allowed action is irreversible — same rule as engage dogfood.
- `dryRun` in `budget` means irreversible primitives **simulate or skip commit**; evidence still records what would have happened.

### What is *not* a primitive

- `scout_threads`, `post_comment`, `engage_discover` — **domain** action ids used by CommunityEngager today. Under compose, they become **pack expansions** (recipes) → sequences of primitives + domain parameters, not catalog roots.
- Free-form “do anything” with no catalog id — **out of scope**. Compose may only emit primitives (and pack expansions that reduce to them).

### Binding sketch

```text
primitive ──► protocol engine (declare / invoke / observe / evidence)
          └─► browser engine (navigate / observe DOM / type / click → maps to read/write/invoke)
```

Same Spec; per-action `actionBinding` overrides Spec default. See [`protocol-engine.md`](./protocol-engine.md).

---

## Compose path (single compiler story)

```text
Intent (goal + optional slots)
        │
        ▼
  compose(intent, catalog, packs?)
        │
        ├─ resolve pack?  (e.g. slots.entrypoint=engage → engage recipe)
        │       └─ expand → primitive multiset + constraints + acceptance + HITL + budget
        │
        └─ or direct: NL/slots → choose primitives + constraints (still catalog-bound)
        │
        ▼
  Spec (draft)  allowedActions ⊆ catalog (+ pack metadata in constraints if useful)
        │
     freeze / Spec HITL
        ▼
  Spec (frozen) ── run under engines bound to those primitives
```

**One compose function; many packs.** Not one compiler package forever per app.

Implementation (protocol): [`packages/protocol/src/compose.ts`](../packages/protocol/src/compose.ts) — `composeIntent`, `DomainPack`, `ComposeExpansion`.

CommunityEngager packs: [`apps/community-engager/src/spec/packs/community-engager-packs.ts`](../apps/community-engager/src/spec/packs/community-engager-packs.ts) — use `composeCommunityIntent` (or `compileEngageIntent` alias).

### Domain pack example — engage (illustrative)

Recipe `community-engager/engage` expands roughly to:

1. `observe` / `read` — allowlist, queue, memory  
2. `invoke` or browser-mapped scout — find candidates (still constrained)  
3. `assert` — score / policy gates  
4. `wait_human` — draft HITL  
5. `write` — post comment only after approve  

`post_watch` is another recipe on the same primitive set. Packs may add **constraints** (`allowlist_only`, `no_promo`) and **acceptance** items; they must not introduce unbound action ids outside the catalog + documented pack aliases.

### Procedure field today vs later

Current `Spec.procedure = { appId, entrypoint }` points at a dogfood manifest. Under compose:

- **Near term:** `procedure` may still name a pack (`community-engager` / `engage`) while `allowedActions` migrate toward primitive ids (or dual-list during transition).
- **Later:** `procedure` can mean “compose run” / pack id, with the **runtime executing the primitive plan** rather than a fixed stage graph invented outside the Spec.

No requirement to rewrite CommunityEngager manifests before the catalog and persistence land.

---

## Non-goals (this sketch)

- Implementing the primitive runtime or migrating engage off manifests
- LLM inventing stages **outside** the catalog
- Per-app IntentCompiler registry as the architecture (packs are data/recipes, not separate product compilers)
- Full Intent Router / multi-app OS

---

## Open questions (resolve in follow-on)

1. Exact TypeScript shape: `PrimitiveDef` in `@relay/protocol` vs docs-only until v1 types.
2. Whether pack aliases (`post_comment`) stay as allowed action ids that *map* to `write`, or Specs only list primitives.
3. Ordering: Spec lists allowed set only, or also an ordered plan? (v0: **allowed set + constraints**; ordering is engine/pack concern until needed.)
4. How VoltMem / evidence artifacts attach to `assert` ids.

---

## Next steps (plan)

1. ~~`primitive-catalog-sketch` + `compose-compiler-direction`~~ — this doc  
2. ~~`spec-persistence`~~ — see [`spec.md`](./spec.md) (Spec store)  
3. ~~`protocol-engine-sketch`~~ — see [`protocol-engine.md`](./protocol-engine.md)  
4. Later plan: compose implementation + optional engage pack expansion  

## Acceptance for this todo

- [x] Small domain-free primitive table with side effects and binding notes  
- [x] Compose story documented; engage framed as pack/recipe  
- [x] Linked from Spec docs / plan Phase E  
