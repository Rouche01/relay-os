# Compose demo (universal Intent → Spec POC)

**Story:** Say what you want → **compose** via a domain pack → frozen Spec → protocol check → real CommunityEngager run under that Spec.

This is the pack-based path from [`primitives.md`](./primitives.md). Engage is a **recipe**, not a separate compiler architecture.

## Run

```bash
cd ~/Projects/relay-os
nvm use   # Node 22
pnpm --filter @relay/protocol build
pnpm --filter @relay/apps-community-engager build
pnpm --filter @relay/apps-community-engager compose-demo
```

Script: [`apps/community-engager/src/host/compose-demo.ts`](../apps/community-engager/src/host/compose-demo.ts)

## What it walks

| Step | What happens |
|------|----------------|
| 1 | Create **Intent** (goal + slots) |
| 2 | **`composeCommunityIntent`** → pack `community-engager/engage` → freeze → persist |
| 3 | Print **primitives** vs **aliases** on the Spec |
| 4 | **ProtocolEngineStub** — observe, evidence, dry-run `write`, refuse out-of-spec |
| 5 | **CommunityEngager** run under that Spec (fixtures + scripted HITL) |

## Checklist

- [ ] `packId=community-engager/engage` in logs  
- [ ] Spec lists primitives (`observe`, `write`, …) and aliases (`scout_threads`, `post_comment`, …)  
- [ ] Protocol stub simulates dry-run write and refuses unknown actions  
- [ ] CommunityEngager completes with dry-run posts  
- [ ] `compose-demo` exits 0  

## Related

- Protocol compose: [`packages/protocol/src/compose.ts`](../packages/protocol/src/compose.ts)  
- Packs: [`community-engager-packs.ts`](../apps/community-engager/src/spec/packs/community-engager-packs.ts)  
- Protocol engine sketch: [`protocol-engine.md`](./protocol-engine.md)  
- Classic thesis demo (same run loop, compile API name): [`thesis-demo.md`](./thesis-demo.md)  
