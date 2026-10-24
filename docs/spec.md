# Spec & Intent (protocol)

Human-owned authority for agent computer work. Types live in `@relay/protocol`:

- [`packages/protocol/src/spec.ts`](../packages/protocol/src/spec.ts) — Spec, freeze/thaw, acceptance, procedure binding
- [`packages/protocol/src/intent.ts`](../packages/protocol/src/intent.ts) — Intent → compiles into a Spec

**Thesis:** Intent → frozen Spec → run → prove acceptance → negotiate before irreversible act.

**Engines:** Spec may bind `protocol` (preferred) or `browser` (GUI fallback). Manifests still define stages; Spec authorizes and defines “done.”

See readiness plan: [`.cursor/plans/relay_intent_spec_verify_hitl.plan.md`](../.cursor/plans/relay_intent_spec_verify_hitl.plan.md).
