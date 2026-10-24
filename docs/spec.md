# Spec & Intent (protocol)

Human-owned authority for agent computer work. Types live in `@relay/protocol`:

- [`packages/protocol/src/spec.ts`](../packages/protocol/src/spec.ts) — Spec, freeze/thaw, acceptance, procedure binding
- [`packages/protocol/src/intent.ts`](../packages/protocol/src/intent.ts) — Intent → compiles into a Spec

**Thesis:** Intent → frozen Spec → run → prove acceptance → negotiate before irreversible act.

**Engines:** Spec may bind `protocol` (preferred) or `browser` (GUI fallback). Manifests still define stages; Spec authorizes and defines “done.”

**North star catalog:** domain-free **primitives** + compose Intent→Spec — see [`primitives.md`](./primitives.md). CommunityEngager below is a **domain pack** (dogfood), not the end architecture.

## CommunityEngager compiler (v1)

Template fill only — no free-form stage invention:

- [`apps/community-engager/src/spec/engage-compiler.ts`](../apps/community-engager/src/spec/engage-compiler.ts)
- `compileEngageFromSlots(goal, slots)` → `{ intent, spec }` draft Spec with `procedure.appId = community-engager` and `entrypoint` `engage` | `post_watch`
- Slots: `entrypoint`, `maxJobs`, `dryRun`, `forceDiscover`, `allowPromo`, `adapter` (`cli` | `telegram` — HITL surface; recorded as Spec constraint `hitl_adapter_*`)
- Host: `--adapter=cli|telegram` on `run-dev` (or `FEEDBACK_ADAPTER`) picks the feedback adapter; with `--with-spec`, the slot is compiled into the Spec

Freeze with `freezeSpec(spec)` from `@relay/protocol` before treating the brief as law.

## Spec persistence

- Protocol: [`packages/protocol/src/spec-store.ts`](../packages/protocol/src/spec-store.ts) — `SpecBundle` (Intent + Spec), `SpecStore` port, `createSpecBundle`
- File driver: [`apps/community-engager/src/spec/file-spec-store.ts`](../apps/community-engager/src/spec/file-spec-store.ts) — `{dataDir}/specs.json`
- `run-dev --with-spec` saves the bundle; `--spec-id=<id>` loads and runs under that Spec
- App re-saves after Spec HITL (Approve / Edit / Abort) when `intent` + `specStore` are set

## Evidence pack

- Protocol: [`packages/protocol/src/evidence.ts`](../packages/protocol/src/evidence.ts) — `evaluateSpecEvidence`
- CommunityEngager: [`apps/community-engager/src/spec/evidence-pack.ts`](../apps/community-engager/src/spec/evidence-pack.ts)
- When `CommunityEngagerApp` is constructed with `spec` (frozen/running), that Spec is copied to fanout children; **execute fails closed** unless the pre-execute evidence pack is complete
- **Runtime bind** ([`runtime-bind.ts`](../apps/community-engager/src/spec/runtime-bind.ts)): frozen Spec enforces `maxJobs`, `dryRun`, `force_discover`, and `no_promo` during the run
- **Spec HITL** ([`hitl-spec.ts`](../apps/community-engager/src/spec/hitl-spec.ts)): with `spec` + adapter, Approve / Edit / Abort the Spec **before** stages (default on; `--skip-spec-hitl` to skip)
- Runs **without** `ctx.spec` behave as before (legacy)

## Cold demo

See [`thesis-demo.md`](./thesis-demo.md) — `pnpm --filter @relay/apps-community-engager thesis-demo`.

See readiness plan: [`.cursor/plans/relay_intent_spec_verify_hitl.plan.md`](../.cursor/plans/relay_intent_spec_verify_hitl.plan.md).
