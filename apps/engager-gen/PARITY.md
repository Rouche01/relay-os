# Parity vs CommunityEngager

**Phase:** hand-written Spec + scaffold path from `intent.md` (offline stub oracle).

| Check | engager-gen | Real CE | Notes |
| --- | --- | --- | --- |
| Scout fixtures | `fixtures/threads.json` (allowlisted subset) | `src/fixtures/threads.ts` | Same threads; OUTFITS excluded from scout replay |
| Draft mean soft-judge | stub LLM scores 4/5 | `eval:drafts` / Gemini judge | Stub only until live LLM parity run |
| Hard `no_promo_links` | eval case blocks link drafts | draft gate / evidence | Shared rule intent |
| HITL before post | `human.approve` in Spec | `await_approval` stage | |
| Dry-run post | `api.request` comment + `budget.dryRun` | CE dry-run execute | |
| Intent → Spec | `pnpm start:intent` / `fromIntent: true` via `@relay/spec-scaffold` | n/a | Stub returns `spec.yaml` after one repair; swap stub for live LLM to measure generation |
| Interstitials / cadence / post-watch | out of scope | CE only | |

Fill mean draft-judge delta when running a live LLM scaffolder (pass if within 0.5 of CE on the same fixtures).
