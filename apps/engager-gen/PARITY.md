# Parity vs CommunityEngager

**Phase:** hand-written Spec (pre-scaffolder).

| Check | engager-gen | Real CE | Notes |
| --- | --- | --- | --- |
| Scout fixtures | `fixtures/threads.json` (allowlisted subset) | `src/fixtures/threads.ts` | Same threads; OUTFITS excluded from scout replay |
| Draft mean soft-judge | stub LLM scores 4/5 | `eval:drafts` / Gemini judge | Stub only until live LLM parity run |
| Hard `no_promo_links` | eval case blocks link drafts | draft gate / evidence | Shared rule intent |
| HITL before post | `human.approve` in Spec | `await_approval` stage | |
| Dry-run post | `api.request` comment + `budget.dryRun` | CE dry-run execute | |
| Interstitials / cadence / post-watch | out of scope | CE only | |

After `@relay/spec-scaffold` lands, re-run from `intent.md` and fill mean draft-judge delta (pass if within 0.5 of CE on the same fixtures).
