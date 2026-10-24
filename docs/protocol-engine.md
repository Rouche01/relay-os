# Protocol engine (sketch)

**Status:** design + in-memory stub. No migration of CommunityEngager off browser.  
**Plan:** `protocol-engine-sketch` in [`.cursor/plans/relay_intent_spec_verify_hitl.plan.md`](../.cursor/plans/relay_intent_spec_verify_hitl.plan.md).

**Thesis link:** Same **Spec** authorizes work. Engines differ; authority does not.

| Path | When | Surface |
|------|------|---------|
| **Protocol** (preferred) | System exposes Spec-shaped capabilities | `declare` → `invoke` / `observe` → `evidence` |
| **Browser** (fallback) | GUI-only / closed apps | navigate / DOM observe / click / type → maps into the same primitives |

Primitives: [`primitives.md`](./primitives.md). Spec types: [`spec.md`](./spec.md).

---

## Dual path under one Spec

```text
                    Spec (frozen)
                    allowedActions ⊆ primitives (+ pack aliases)
                    actionBinding: protocol | browser
                           │
           ┌───────────────┴───────────────┐
           ▼                               ▼
   ProtocolEngine                    Browser engine
   declare(spec)                     (Playwright today)
   session.invoke(primitive)         navigate / observe DOM
   session.observe(query)            click / type → write|invoke
   session.evidence(phase)           evidence pack (same evaluateSpecEvidence)
           │                               │
           └───────────────┬───────────────┘
                           ▼
                    HITL / dryRun / fail-closed
```

Per-action `actionBinding` may override Spec default. CommunityEngager dogfood remains **browser** until packs expand to primitives and protocol capabilities exist for Reddit-class work.

---

## Lifecycle (protocol)

1. **declare(spec)** — require `frozen` | `running`; open a session bound to that Spec  
2. **observe / read** — no side effect; fill world state  
3. **invoke / write** — must be in `allowedActions`; irreversible + `budget.dryRun` → simulate only  
4. **assert / evidence** — `evaluateSpecEvidence` (same as engage pre-execute gate)  
5. **wait_human** — defer to FeedbackBroker / Spec HITL (stub does not open a channel)  
6. **teardown** — end session  

---

## Code

| Piece | Location |
|-------|----------|
| Types + stub | [`packages/protocol/src/protocol-engine.ts`](../packages/protocol/src/protocol-engine.ts) |
| `EngineType` | includes `"protocol"` in [`engines.ts`](../packages/protocol/src/engines.ts) |
| Evidence | shared [`evidence.ts`](../packages/protocol/src/evidence.ts) |

```ts
import {
  createProtocolEngineStub,
  freezeSpec,
  // …
} from "@relay/protocol";

const engine = createProtocolEngineStub([
  { id: "mem.recall", primitive: "invoke", sideEffect: "none" },
]);
const session = await engine.declare(frozenSpec);
await session.observe({ query: "allowlist" });
session.recordEvidence("dry_run_or_approved_write", {
  status: "satisfied",
  detail: "dry-run",
});
const pack = session.evidence("pre_execute");
const write = await session.invoke({
  actionId: "write",
  primitive: "write",
  params: { body: "…" },
});
// write.dryRunSimulated === true when Spec.budget.dryRun
await session.teardown();
```

Stub **refuses** actions not listed on the Spec — that is the point of the sketch.

---

## Mapping browser → primitives (compat)

| Browser / computer-use | Primitive |
|------------------------|-----------|
| Page snapshot / a11y tree | `observe` |
| Goto URL | `navigate` |
| Click / type into composer | `invoke` or `write` (side-effect class) |
| Read cookie / local file | `read` |
| Post comment / submit form | `write` |
| HITL card | `wait_human` |
| Score / allowlist gate | `assert` |

Engage domain ids (`scout_threads`, `post_comment`, …) stay pack aliases until compose emits primitive ids.

---

## Non-goals (this sketch)

- Replacing Playwright for CommunityEngager  
- Full capability registry / multi-app protocol bus  
- Inventing stages outside the primitive catalog  

## Next (follow-on)

- Register real capabilities (memory, HTTP, store) behind `invoke`  
- Optional manifest `engines_required: ["protocol"]` for Spec-native apps  
- Compose compiler emits primitive `allowedActions` for protocol-first packs  

## Acceptance

- [x] Doc: protocol vs browser under one Spec  
- [x] Stub: declare / invoke / observe / evidence gated by Spec  
- [x] Aligned with primitive catalog; `EngineType` includes `protocol`  
