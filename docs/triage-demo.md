# Triage E2E cold demo

**Thesis:** plain-text GitHub bug-triage intent → frozen Spec → shadow gate → scheduled live ticks with HITL before every comment and **zero duplicate posts** on re-run.

Forcing-function fixture: [`apps/triage-gen/`](../apps/triage-gen/). Plan: [`relay_spec_to_working_app.plan.md`](../.cursor/plans/relay_spec_to_working_app.plan.md) · `e2e-triage-demo`.

## Run (offline / CI)

```bash
cd ~/Projects/relay-os
nvm use   # Node 22
pnpm install
pnpm --filter @relay/protocol build
pnpm --filter @relay/workflow-runtime build
pnpm --filter @relay/spec-host build
# …or rebuild the packages you need; cold-demo depends on built workspace dists

pnpm --filter @relay/apps-triage-gen cold-demo
# or: pnpm --filter @relay/apps-triage-gen test
```

Script: [`apps/triage-gen/src/cold-demo.ts`](../apps/triage-gen/src/cold-demo.ts)

Default mode uses `fixtures/issues.json` + stub LLM (no network, no GitHub token).

## Live GitHub reads (optional)

```bash
export GITHUB_TOKEN=ghp_…   # or GH_TOKEN
# Point slots in intent / Spec at a real owner/repo before relying on this.
pnpm --filter @relay/apps-triage-gen cold-demo -- --live-github
```

Shadow uses live list; live ticks still post via fixtures so the demo never spam-comments.

## What it walks

| Step | What happens |
|------|----------------|
| 1 | Load locked [`intent.md`](../apps/triage-gen/intent.md) |
| 2 | Validate [`spec.expected.yaml`](../apps/triage-gen/spec.expected.yaml) against curated `github` + `github:default` |
| 3 | Freeze Spec → content-addressed Relay App bundle (schedules from trigger + outcomes) |
| 4 | **Shadow** run — reads (fixture or live) + simulated irreversible writes |
| 5 | Approve shadow evidence → `enableSpecScheduler` (shadow gate) |
| 6 | **Live tick 1** — HITL auto-approve → comment posts (`once` keys commit) |
| 7 | **Live tick 2** — same issues → `once` skips → **0** successful posts |

No GitHub-specific host code — only `@relay/services` `github` + `@relay/spec-host`.

## Checklist (demo done when)

- [ ] `pnpm --filter @relay/apps-triage-gen cold-demo` exits 0  
- [ ] Logs show validate → freeze → shadow → approve → enable → tick 1 posts → tick 2 once-skips  
- [ ] Tick 2 reports **0** successful posts  
- [ ] Spec has no GitHub logic outside the descriptor (`packages/services/descriptors/github.yaml`)  
- [ ] (Optional) `--live-github` with `GITHUB_TOKEN` shadows against a real repo  

## Related

- Success bar: [`apps/triage-gen/SUCCESS.md`](../apps/triage-gen/SUCCESS.md)  
- Thesis demo (CE): [`docs/thesis-demo.md`](./thesis-demo.md)  
- Shadow gate: [`packages/spec-host/SHADOW.md`](../packages/spec-host/SHADOW.md)  
- Once: [`packages/spec-host/ONCE.md`](../packages/spec-host/ONCE.md)  
