# Desk closed-loop smoke (ASAP)

Manual checklist for the **GitHub triage** dogfood path. Automated twin:
`pnpm --filter @relay/apps-relay-shell test` (`closed-loop-smoke.test.ts`).

## Prerequisites

1. Spec API: `pnpm --filter @relay/runtime build` then `pnpm --filter @relay/apps-relay-shell api`
2. Desk (Tauri or Vite) pointed at `http://127.0.0.1:8790`
3. Optional live secrets: `GITHUB_TOKEN` + `RELAY_CONNECTIONS` in `apps/relay-shell/.env` (Settings → Probe connections)

## UI path

1. **Build → + New spec** — keep **GitHub triage** → Create draft  
2. **Verify → Run checks** — must pass (or fix YAML)  
3. **Ship** — Freeze → Install → **mark** `github:default` → Shadow → Approve evidence  
4. **Apps** — select the app → **Run once** → Confirm run  
5. Expect pause → **Open Seats** (or Activity) → **Approve**  
6. Runs list shows Finished; optional **Enable** schedule (separate from Run once)

## Pass / fail

| Check | Pass |
|-------|------|
| Scaffold is GitHub (not Reddit stub) | ✓ |
| Ship gate completes | ✓ |
| Run once appears under Runs | ✓ |
| HITL pauses (does not skip to post) | ✓ |
| Resume completes the run | ✓ |
| Enable works after evidence approve | ✓ |

## Not this smoke

- Reddit / CE fashion write  
- Live network GitHub without fixtures (Desk still blocks network in dogfood)  
- Freight / open services
