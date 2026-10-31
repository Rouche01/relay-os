# Parity vs CommunityEngager

**Phase:** live-LLM / stub soft-judge + scaffold success rate (`v4-live-llm-parity`).

| Check | engager-gen | Real CE | Notes |
| --- | --- | --- | --- |
| Scout fixtures | `fixtures/threads.json` (allowlisted subset) | `src/fixtures/threads.ts` | Same capsule thread; OUTFITS excluded from scout replay |
| Draft mean soft-judge | `pnpm parity` → `draft.meanDelta` | `eval:drafts -- --judge` | Same 1–5 dimensions (`threadFit` / `soundsHuman` / `specificity`) |
| Hard `no_promo_links` | eval case blocks link drafts | draft gate / evidence | Shared rule intent |
| HITL before post | `human.approve` in Spec | `await_approval` stage | |
| Dry-run post | `api.request` comment + `budget.dryRun` | CE dry-run execute | |
| Intent → Spec | `pnpm start:intent` / `pnpm parity` scaffold rows | n/a | Stub or live LLM via `tryCreateLiveLlmClient` |
| Interstitials / cadence / post-watch | out of scope | CE only | |

## Gate

**Pass** when `|mean(gen) − mean(ce)| ≤ 0.5` on `fixtures/parity-cases.json` (shared threads; gen vs CE-baseline drafts), and offline scaffold rows match `expectOk` in `fixtures/parity-intents.json`.

```bash
# Offline CI (stub judge + parity scaffold stub)
pnpm --filter @relay/apps-engager-gen parity -- --stub

# Live when LLM_PROVIDER + API keys are set
pnpm --filter @relay/apps-engager-gen parity
```

Writes `parity-results.json` (gitignored) with mode, means, delta, and scaffold rate.

## Last offline stub run

| Metric | Value |
| --- | --- |
| Draft mean delta | ≤ 0.5 (stub scores both sides 4 → delta ~0) |
| Scaffold success rate | 2/4 fashion intents ok; freight + nonsense fail as expected |
| Expectation match | 4/4 |

Fill live means after a keyed parity run; keep the 0.5 delta gate.
