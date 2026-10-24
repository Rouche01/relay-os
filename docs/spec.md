# Spec & Intent (protocol)

Human-owned authority for agent computer work. Types live in `@relay/protocol`:

- [`packages/protocol/src/spec.ts`](../packages/protocol/src/spec.ts) — Spec, freeze/thaw, acceptance, procedure binding
- [`packages/protocol/src/intent.ts`](../packages/protocol/src/intent.ts) — Intent → compiles into a Spec

**Thesis:** Intent → frozen Spec → run → prove acceptance → negotiate before irreversible act.

**Engines:** Spec may bind `protocol` (preferred) or `browser` (GUI fallback). Manifests still define stages; Spec authorizes and defines “done.”

## CommunityEngager compiler (v1)

Template fill only — no free-form stage invention:

- [`apps/community-engager/src/spec/engage-compiler.ts`](../apps/community-engager/src/spec/engage-compiler.ts)
- `compileEngageFromSlots(goal, slots)` → `{ intent, spec }` draft Spec with `procedure.appId = community-engager` and `entrypoint` `engage` | `post_watch`
- Slots: `entrypoint`, `maxJobs`, `dryRun`, `forceDiscover`, `allowPromo`

Freeze with `freezeSpec(spec)` from `@relay/protocol` before treating the brief as law.

## Evidence pack

- Protocol: [`packages/protocol/src/evidence.ts`](../packages/protocol/src/evidence.ts) — `evaluateSpecEvidence`
- CommunityEngager: [`apps/community-engager/src/spec/evidence-pack.ts`](../apps/community-engager/src/spec/evidence-pack.ts)
- When `CommunityEngagerApp` is constructed with `spec` (frozen/running), that Spec is copied to fanout children; **execute fails closed** unless the pre-execute evidence pack is complete
- Runs **without** `ctx.spec` behave as before (legacy)

See readiness plan: [`.cursor/plans/relay_intent_spec_verify_hitl.plan.md`](../.cursor/plans/relay_intent_spec_verify_hitl.plan.md).
