# Thesis demo (cold script)

**Thesis:** Agents that compile intent into a frozen spec, run against it, prove acceptance, and negotiate with you before they act.

This is the documented dogfood path on **CommunityEngager** (fixtures + dry-run). No live Reddit posts.

## Run

```bash
cd ~/Projects/relay-os
nvm use   # Node 22
pnpm --filter @relay/protocol build
pnpm --filter @relay/apps-community-engager build
pnpm --filter @relay/apps-community-engager thesis-demo
```

Script: [`apps/community-engager/src/host/thesis-demo.ts`](../apps/community-engager/src/host/thesis-demo.ts)

## What it walks

| Step | What happens |
|------|----------------|
| 1 | Create **Intent** (goal + slots) |
| 2 | **Compile** → draft Spec → **freeze** |
| 3 | **Spec HITL** — Approve the brief |
| 4 | Run stages under Spec (`maxJobs`, `dryRun`, …) |
| 5 | **Evidence pack** must be complete before execute |
| 6 | **Draft HITL** — Approve each reply |
| 7 | **Act** — dry-run post only |

## Interactive (same loop, you type)

```bash
pnpm --filter @relay/apps-community-engager start -- --with-spec \
  --goal "Helpful fashion replies; dry-run"
```

You will Approve/Edit/Abort the Spec first, then each draft. Add `--skip-spec-hitl` to skip Spec approval only.

## Checklist (demo done when)

- [ ] Intent → Spec → freeze is visible in logs  
- [ ] Spec HITL fires before scout/jobs  
- [ ] `[evidence] pre_execute complete` appears before dry-run execute  
- [ ] Draft HITL approve → dry-run transport  
- [ ] `thesis-demo` exits 0  

## Related

- Spec types: [`docs/spec.md`](./spec.md)  
- Readiness plan: [`.cursor/plans/relay_intent_spec_verify_hitl.plan.md`](../.cursor/plans/relay_intent_spec_verify_hitl.plan.md)  
- Viability: [`docs/viability.md`](./viability.md)
