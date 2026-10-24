# Spec primitives & compose (sketch)

**Status:** design sketch + shell compose path live. CE **manifest runtime stays** (additive).  
**Plans:** [`.cursor/plans/relay_intent_spec_verify_hitl.plan.md`](../.cursor/plans/relay_intent_spec_verify_hitl.plan.md) · [`.cursor/plans/primitive_compose_ui_6acdc392.plan.md`](../.cursor/plans/primitive_compose_ui_6acdc392.plan.md)

**Goal:** Almost any Intent becomes a Spec by **mixing domain-free primitives**, not by shipping a new compiler per app. Domain packs (e.g. CommunityEngager `engage`) are optional recipes that expand into the same primitives. **North star:** an engage-like Spec from shell compose is *functionally comparable* to today’s pack expansion — without deleting the manifest path.

Related: [`spec.md`](./spec.md) (types + engage dogfood), [`spec-ui.md`](./spec-ui.md) (shell decide → compose), [`viability.md`](./viability.md).

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

Implementation (protocol): [`packages/protocol/src/compose.ts`](../packages/protocol/src/compose.ts) — `composeIntent`, `composeFromPrimitives`, `DomainPack`, `ComposeExpansion`.

Decide picker: [`packages/engines-decide/src/pick-primitives.ts`](../packages/engines-decide/src/pick-primitives.ts) — `pickPrimitivesForGoal` (Jev | heuristic).

CommunityEngager packs: [`apps/community-engager/src/spec/packs/community-engager-packs.ts`](../apps/community-engager/src/spec/packs/community-engager-packs.ts) — use `composeCommunityIntent` (or `compileEngageIntent` alias).

Shell wiring: [`docs/spec-ui.md`](./spec-ui.md).

### Domain pack example — engage (parity target)

Recipe `community-engager/engage` expands to **primitives + documented aliases**. Source of truth for fields: [`engage-spec-fields.ts`](../apps/community-engager/src/spec/engage-spec-fields.ts) (`buildPrimitiveActions` + `buildAliasActions`).

| Engage concern (today) | Catalog primitive | Notes |
|------------------------|-------------------|--------|
| Session / page / allowlist / memory | `observe`, `read` | Browser + store |
| Open Reddit / move surfaces | `navigate` | Browser binding |
| Scout / draft tools | `invoke` | Reversible; aliases e.g. `scout_threads`, `draft_reply` |
| Score / policy / evidence gates | `assert` | Evidence pack |
| Spec + draft HITL | `wait_human` | Feedback Broker / Spec UI |
| Post comment (irreversible) | `write` | Alias `post_comment`; always behind HITL |

**CE-parity Spec (acceptance for shell compose):** for an engage-like free-form goal, decide + `composeFromPrimitives` should yield a draft whose `allowedActions` **include at least**:

`observe`, `read`, `navigate` and/or `invoke`, `assert`, `wait_human`, `write`

(plus `before_irreversible` HITL when `write` is present — enforced by `ensurePrimitiveSafety`).

Aliases (`scout_threads`, `post_comment`, …) remain **pack-only**; the shell compose path does **not** invent them. A Spec that lists the primitive set above is the governance parity target; the **manifest stage graph** remains how CE actually runs today.

`post_watch` is another recipe on the same primitive set (poll → draft → HITL → write). Packs may add **constraints** (`allowlist_only`, `no_promo`) and **acceptance** items; they must not introduce unbound action ids outside the catalog + documented pack aliases.

### Two paths (coexist)

```text
A) Manifest dogfood (unchanged)
   Intent → community-engager/engage pack → Spec (primitives+aliases)
        → procedure binds engage stages → browser runtime

B) Shell primitive compose (new)
   Intent goal → engines-decide → composeFromPrimitives
        → Spec (catalog subset, packId relay/primitives)
        → human Approve / Abort in Spec UI
```

Hard invariant: **A keeps working.** B is additive governance / thesis UI. Migrating A’s *runtime* onto a pure primitive executor is a later plan with an explicit dogfood gate — not a silent rewrite.

### Procedure field today vs later

Current `Spec.procedure = { appId, entrypoint }` points at a dogfood manifest. Under compose:

- **Near term:** CE packs still set `procedure` to `community-engager` / `engage|post_watch`. Shell primitive Specs use `relay` / `compose`.
- **Later (optional):** `procedure` can mean “compose run” / pack id, with the **runtime executing the primitive plan** rather than a fixed stage graph invented outside the Spec.

No requirement to rewrite CommunityEngager manifests for shell compose or CE-parity docs to land.

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
4. ~~Compose + engage packs + demo~~ — `composeCommunityIntent`, packs, [`compose-demo.md`](./compose-demo.md)  
5. ~~Shell decide → composeFromPrimitives → Spec UI~~ — [`spec-ui.md`](./spec-ui.md)  
6. ~~CE-parity sketch~~ — engage → primitive table above (manifest path kept)  
7. Follow-on: automated parity check (engage pack primitives ⊆ / ≈ shell pick for engage-like goals); primitive runtime still deferred  

## Acceptance for this todo

- [x] Small domain-free primitive table with side effects and binding notes  
- [x] Compose story documented; engage framed as pack/recipe  
- [x] Linked from Spec docs / plan Phase E  
- [x] CE-parity: engage concern → primitive map + coexistence of manifest vs shell paths  

