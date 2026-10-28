# Spec & Intent (protocol)

Human-owned authority for agent computer work. Types live in `@relay/protocol`:

- [`packages/protocol/src/spec.ts`](../packages/protocol/src/spec.ts) — Spec v1, freeze/thaw, acceptance, procedure binding (CommunityEngager dogfood)
- [`packages/protocol/src/spec-v2.ts`](../packages/protocol/src/spec-v2.ts) — Spec v2: ordered capability steps + goal-derived rules (hard/soft/outcome); YAML/JSON authoring
- [`packages/protocol/src/spec-v2.schema.json`](../packages/protocol/src/spec-v2.schema.json) — JSON Schema for Spec v2 bodies (`SPEC_V2_JSON_SCHEMA`)
- [`packages/protocol/src/engine-catalog.ts`](../packages/protocol/src/engine-catalog.ts) — fixed `engine.capability` catalog for Spec v2 `use` fields
- [`packages/protocol/src/service-descriptor.ts`](../packages/protocol/src/service-descriptor.ts) — OpenAPI-ish service descriptors for `api.request` (`service` + `operation`)
- [`packages/protocol/services/`](../packages/protocol/services/) — hand-written `reddit-public.yaml` / `reddit-oauth.yaml` (CE-lite schema source)
- [`packages/spec-validator`](../packages/spec-validator) — Spec v2 validate (`validateSpecV2`): structure, capabilities, dataflow, services, HITL-before-irreversible, rule coverage
- [`packages/engines-api`](../packages/engines-api) — generic `api.request` engine (descriptors, connection refs, dryRun simulate, fixtures)
- [`packages/engines-llm`](../packages/engines-llm) — generic `llm.generate|classify|extract|judge` over `@relay/llm`
- [`packages/engines-data`](../packages/engines-data) — generic `data.get|put|query|append` over `DataStore` / `MemoryDataStore`
- [`packages/protocol/src/intent.ts`](../packages/protocol/src/intent.ts) — Intent → compiles into a Spec

**Thesis:** Intent → frozen Spec → run → prove acceptance → negotiate before irreversible act.

**Engines:** Spec may bind `protocol` (preferred) or `browser` (GUI fallback). Manifests still define stages; Spec authorizes and defines “done.”

**North star catalog:** domain-free **primitives** + compose Intent→Spec — see [`primitives.md`](./primitives.md) (includes **CE-parity**: engage as primitive expansion; manifest runtime stays). Protocol API: `composeIntent` / `composeFromPrimitives` / `DomainPack` in [`compose.ts`](../packages/protocol/src/compose.ts). CommunityEngager below is a **domain pack** (dogfood), not the end architecture.

**Protocol vs browser:** same Spec, two engines — see [`protocol-engine.md`](./protocol-engine.md) (`ProtocolEngineStub` in `@relay/protocol`).

## CommunityEngager compiler (v1 → compose packs)

Pack-based compose — no free-form stage invention:

- Protocol: `composeIntent` + [`DomainPack`](../packages/protocol/src/compose.ts)
- Packs: [`community-engager-packs.ts`](../apps/community-engager/src/spec/packs/community-engager-packs.ts) (`community-engager/engage` | `…/post_watch`)
- App entry: `composeCommunityIntent` / `compileEngageFromSlots` (legacy alias) → `{ intent, spec, packId }`
- Spec includes **primitives** (`observe`, `write`, …) **and** stage aliases (`scout_threads`, `post_comment`, …); `procedure` still binds engage/post_watch for the browser runtime
- Slots: `entrypoint` / `pack`, `maxJobs`, `dryRun`, `forceDiscover`, `allowPromo`, `adapter` (`cli` | `telegram`)
- Host: `--adapter=cli|telegram` on `run-dev` (or `FEEDBACK_ADAPTER`); with `--with-spec`, the slot is composed into the Spec

Freeze with `freezeSpec(spec)` from `@relay/protocol` before treating the brief as law.

## Spec persistence

- Protocol: [`packages/protocol/src/spec-store.ts`](../packages/protocol/src/spec-store.ts) — `SpecBundle` (Intent + Spec), `SpecStore` port, `createSpecBundle`
- File driver: [`@relay/spec-store`](../packages/spec-store) — app-agnostic `{dataDir}/specs.json`
- Governance API/UI: Relay shell — [`docs/spec-ui.md`](./spec-ui.md) (not CommunityEngager-owned)
- CommunityEngager `run-dev --with-spec` may still save under its own dataDir for dogfood runs

## Evidence pack

- Protocol: [`packages/protocol/src/evidence.ts`](../packages/protocol/src/evidence.ts) — `evaluateSpecEvidence`
- CommunityEngager: [`apps/community-engager/src/spec/evidence-pack.ts`](../apps/community-engager/src/spec/evidence-pack.ts)
- When `CommunityEngagerApp` is constructed with `spec` (frozen/running), that Spec is copied to fanout children; **execute fails closed** unless the pre-execute evidence pack is complete
- **Runtime bind** ([`runtime-bind.ts`](../apps/community-engager/src/spec/runtime-bind.ts)): frozen Spec enforces `maxJobs`, `dryRun`, `force_discover`, and `no_promo` during the run
- **Spec HITL** ([`hitl-spec.ts`](../apps/community-engager/src/spec/hitl-spec.ts)): with `spec` + adapter, Approve / Edit / Abort the Spec **before** stages (default on; `--skip-spec-hitl` to skip)
- Runs **without** `ctx.spec` behave as before (legacy)

## Spec UI (governance)

App-agnostic shell: [`spec-ui.md`](./spec-ui.md) — `pnpm --filter @relay/apps-relay-shell dev:all`

## Cold demos

- Thesis (HITL loop): [`thesis-demo.md`](./thesis-demo.md) — `pnpm --filter @relay/apps-community-engager thesis-demo`
- Compose POC (universal compose + protocol stub + run): [`compose-demo.md`](./compose-demo.md) — `pnpm --filter @relay/apps-community-engager compose-demo`

See readiness plan: [`.cursor/plans/relay_intent_spec_verify_hitl.plan.md`](../.cursor/plans/relay_intent_spec_verify_hitl.plan.md).
