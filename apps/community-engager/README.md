# CommunityEngager

First Relay dogfood app: discover fashion/styling subreddits (HITL promote onto allowlist), scout postable subs, draft a reply, **pause for human Approve / Edit / Abort**, then optionally post, then write outcomes to VoltMem.

**Hard rule:** nothing posts without human Approve (`REDDIT_DRY_RUN=true` by default).  
**Allowlist rule:** discovery only proposes; a sub is not postable until a human promotes it.

Related plans:

- [HITL + CommunityEngager + VoltMem](../../.cursor/plans/relay_hitl_community_voltmem.plan.md) — Phase 6 discovery + nested fanout
- [Reddit browser / scrape transport](../../.cursor/plans/relay_reddit_browser.plan.md) — browser scout, ensure_session, interstitial HITL
- [Authority + metrics](../../.cursor/plans/community_engager_authority_metrics.plan.md) — warmup, promo-ratio, post-watch, north-star metrics
- [ThinkPad deploy](../../.cursor/plans/relay_thinkpad_deploy.plan.md) · runbook [`deploy/README.md`](../../deploy/README.md) · [`deploy/SMOKE.md`](../../deploy/SMOKE.md)

## Workflow

Ensure session → **discover** (optional / env) → scout allowlist → queue one job per opportunity → draft → you decide → execute only if approved → memory learns.

```mermaid
flowchart TD
  Start([Start CommunityEngager]) --> EnsJar

  subgraph Ens["0. Ensure session"]
    EnsJar{Cookie jar?}
    EnsJar -->|yes| EnsSkip[Skip]
    EnsJar -->|env user/pass| EnsEnv[Env login]
    EnsJar -->|else| EnsCred[credential FeedbackRequest]
    EnsCred --> EnsLogin[Playwright login + save jar]
  end

  EnsSkip --> Discover
  EnsEnv --> Discover
  EnsLogin --> Discover

  subgraph Disco["1. Discover — read-only"]
    Discover[Search related subs]
    Discover --> ScoreCand[Score topic / activity / help density]
    ScoreCand --> Propose{{choice: promote one or skip}}
    Propose -->|promote| Allow[(.data/allowlist + VoltMem)]
    Propose -->|skip| ScoutSubs
    Allow --> ScoutSubs
  end

  subgraph Targets["2. Target subs"]
    Seed[Static allowlist seed]
    Allow2[(Promoted allowlist)]
    ScoutSubs[Ranked postable subs]
    Seed --> ScoutSubs
    Allow2 --> ScoutSubs
  end

  ScoutSubs --> Src

  subgraph Scout["3. Scout"]
    Src{SCOUT_SOURCE / auto}
    Wall{Anti-bot interstitial?}
    Human[[Human solves challenge · save jar]]
    Blocked[Mark sub blocked · notify · next sub]
    Score[Score ≥ 5 / 8]
    Src -->|browser| SB[Playwright DOM extract]
    Src -->|json| SJ[Public *.json if allowed]
    Src -->|oauth| SO[Reddit API if CLIENT_*]
    Src -->|fail| SF[Fixtures]
    SB --> Wall
    Wall -->|no| Score
    Wall -->|HITL on| Human
    Wall -->|unattended| Blocked
    Human -->|Approve · save jar| Score
    Blocked --> Score
    SJ --> Score
    SO --> Score
    SF --> Score
  end

  Score --> Queue[/Job queue · one runtime per opportunity/]
  Queue --> Job

  subgraph Loop["4. Per-job loop — serial, isolated"]
    Job[Next job]
    Draft[Draft reply + VoltMem context]
    Gate{Human decision}
    DryQ{REDDIT_DRY_RUN?}
    Dry[Log would-post only]
    TxQ{Transport chain}
    EB[Browser comment on thread]
    EO[OAuth API comment if CLIENT_*]
    Rec[Idempotent job record]
    JobLearn[Write outcome to VoltMem]
    Fail[Mark this job failed]
    More{More jobs?}

    Job --> Draft --> Gate
    Gate -->|Approve| DryQ
    Gate -->|Edit: …| DryQ
    Gate -->|Abort| JobLearn
    DryQ -->|true default| Dry --> Rec
    DryQ -->|false| TxQ
    TxQ -->|browser| EB --> Rec
    TxQ -->|oauth fallback| EO --> Rec
    Rec --> JobLearn --> More
    Draft -. error .-> Fail
    EB -. error .-> Fail
    Fail --> More
    More -->|yes| Job
  end

  More -->|no| Summary[Run summary · per-job outcomes]
  Summary --> End([Done])
```

### Stages (short)

| Stage | What happens |
|-------|----------------|
| `ensure_session` | Cookie jar / HITL login before live browser work (skipped when dry-run unless `REDDIT_ENSURE_SESSION=true`) |
| `discover` | Read-only subreddit research → `choice` HITL to promote onto allowlist (or skip) |
| `scout` | Find actionable threads on **postable** allowlist (browser → json → oauth → fixtures); anti-bot wall → headed browser + Telegram/CLI Approve (never auto-solved) |
| `post_watch` | Poll enrolled live posts (24–72h) for replies/removal; prepend follow-up drafts |
| `draft` | Write a reply with Gemini when `GEMINI_API_KEY` is set; otherwise a stub. May pull VoltMem context |
| `await_approval` | You Approve / Edit / Abort (Telegram or CLI) |
| `execute` | Dry-run log, or live browser/oauth post |
| `learn` | Persist outcome to VoltMem (`community_outcome`) + allowlist ranking |

`ensure_session`, `discover`, `scout`, and `post_watch` run once on the parent manifest. The `jobs` stage **fans out** into the nested `CommunityJobManifest` — one isolated `AgentRuntime` per opportunity. A job that fails or gets aborted is recorded and the queue moves on. Budget with `COMMUNITY_MAX_JOBS` (default 3) and `COMMUNITY_JOB_DELAY_MS` (default 1500). Discover defaults to `COMMUNITY_DISCOVER=auto` (skip when the postable allowlist is healthy); use `force` / `--force-discover` to research anyway, or `off` to never run.

### Rules that matter

| Rule | Meaning |
|------|--------|
| Nothing posts without Approve | Abort skips execute |
| `REDDIT_DRY_RUN=true` | Safe default — logs only |
| Browser first | Playwright + cookies; OAuth optional backup |
| Allowlist + score ≥5/8 | problemFit, help, rules, freshness, value, competition, icpFit, plugNaturalness |
| CAPTCHAs are never auto-solved | Detect, then escalate to a human or degrade quietly |
| Discovery proposes, humans promote | A newly researched sub is not postable until approved |
| Warmup forces intensity 0 | Until account age / karma / help-comment thresholds (`warmup` in config) |
| Promo-ratio ledger (~9:1) | Rolling window caps intensity ≥1; `promo.onExceed` = `block` or `warn` |
| Post-watch (24–72h) | After a live post, poll permalink for replies/removal; queue follow-up drafts |
| Soft-CTA drafts | Help first; intensity 0 = no product; 1 = name mention only; 2 = disclose + one LP link (`product.lpBaseUrl` / `GOSTYLENS_LP_BASE_URL`) |
| Sub playbooks | Per-allowlist `playbook`: rules summary, `plugStyle`, `megathreadPolicy`, `maxPlugsPerWeek` — clamps draft intensity and megathread scout |
| Daily cadence | Caps live help/promo posts per local day (`cadence.maxHelpPerDay` / `maxPromoPerDay`); cron entrypoints stay in the schedules plan |
| Visibility check | After live execute, logged-out permalink fetch; flags removal / missing (shadowban-adjacent) |
| Job UTM attribution | LP links: `utm_medium=community-engager`, `utm_campaign=community_<sub>`, `utm_content=<jobId>`; attribution ledger |

Warmup (`warmup.mode=auto`) keeps drafts help-only until local live intensity-0 posts and (when known) Reddit account age/karma clear the thresholds. State: `{REDDIT_DATA_DIR}/warmup/state.json`.

Promo ratio (`promo.maxRatio` default `0.1`, `windowDays` `30`) tracks live posts in `{REDDIT_DATA_DIR}/promo/ledger.json`. When a soft mention would push the window over the max, **`block`** forces intensity 0 (default) or **`warn`** surfaces the ratio in HITL without clamping. See [authority + metrics plan](../../.cursor/plans/community_engager_authority_metrics.plan.md).

Post-watch (`postWatch.enabled`, default on) enrolls each live-posted comment and, on the next parent run after `minAgeHours` (24) and before `maxAgeHours` (72), fetches the public permalink JSON. Replies become intensity-0 follow-up opportunities prepended ahead of scout results; removals are marked. Queue: `{REDDIT_DATA_DIR}/post-watch/queue.json`.

Daily cadence (`cadence.enabled`, default on) counts today's ledger posts and caps opportunities / execute by `maxHelpPerDay` (default 5) and `maxPromoPerDay` (default 1). Per-sub weekly soft mentions stay in playbook `maxPlugsPerWeek`. Separate cron entrypoints are deferred to the schedules plan.

Visibility (`visibility.enabled`, default on) waits `delayMs` (default 3000) then fetches the posted permalink as a logged-out client. Results: `visible` / `removed` / `missing` / `error`; persisted under `{REDDIT_DATA_DIR}/visibility/`. Does not fail the execute stage — warns loudly for ops follow-up. Longer-horizon reply/removal polling stays in post-watch.

UTM on intensity-2 / execute LP links (see `utm.ts`):

| Param | Value | Why |
|-------|--------|-----|
| `utm_source` | `reddit` | Platform |
| `utm_medium` | `community-engager` | This app (stable product filter) |
| `utm_campaign` | `community_<subreddit>` | Community + sub (matches scout draft label) |
| `utm_content` | sanitized `jobId` | Per-post join key |
| `utm_term` | subreddit | Optional bare-sub slice |

Join records: `{REDDIT_DATA_DIR}/attribution/<jobId>.json`.

## Config

| Layer | What goes there |
|-------|-----------------|
| [`config/default.json`](./config/default.json) | Policy defaults (warmup, promo, postWatch, cadence, visibility, discover, scout, jobs, LP URL) |
| `config/local.json` | Optional machine overrides (gitignored; copy [`local.example.json`](./config/local.example.json)) |
| [`.env`](./.env) | Secrets, paths, dry-run / browser host toggles |
| Env vars | Still override any policy key when set (CI / one-offs) |

Load order: built-in defaults → `default.json` → `local.json` → env. Point at another directory with `COMMUNITY_CONFIG_DIR`. Resolved runtime shape is nested (`cfg.warmup.mode`, `cfg.scout.delayMs`, `cfg.reddit.dryRun`, …) via `getCommunityConfig()`.

## Quick start

```bash
# From repo root (Node 22+)
pnpm --filter @relay/engines-browser exec playwright install chromium
cp apps/community-engager/.env.example apps/community-engager/.env
# Optional policy tweaks:
# cp apps/community-engager/config/local.example.json apps/community-engager/config/local.json
# Set Telegram (or FEEDBACK_ADAPTER=cli), REDDIT_USERNAME/PASSWORD for browser path

pnpm --filter @relay/apps-community-engager build
REDDIT_LOGIN_HEADED=true pnpm --filter @relay/apps-community-engager login:reddit   # once
pnpm --filter @relay/apps-community-engager start
```

See [`.env.example`](./.env.example) for secrets/host flags and [`config/default.json`](./config/default.json) for policy knobs.

## Browse / edit local data

Loopback admin (`@relay/admin-shell`) with app-owned adapters:

| Collection | Source env | Capabilities |
|------------|------------|--------------|
| Actions | `ACTION_STORE_PATH` | edit draftText, status, delete |
| Allowlist | `ALLOWLIST_PATH` (default `{REDDIT_DATA_DIR}/allowlist/subreddits.json`) | edit, promote, reject |
| Jobs | `JOBS_DIR` | inspect, delete |
| Runs | `COMMUNITY_RUNS_DIR` (may be outside `.data/`) | inspect, delete, debug charts (timeline, duration×outcome, scout funnel) |

```bash
pnpm --filter @relay/admin-shell build
pnpm --filter @relay/action-store build
pnpm --filter @relay/apps-community-engager build
pnpm --filter @relay/apps-community-engager admin:store
# → http://127.0.0.1:8787
```

Paths are set in [`.env`](./.env) (see [`.env.example`](./.env.example)). Relative values resolve against the `.env` directory.

Action CLI:

```bash
pnpm --filter @relay/apps-community-engager run actions list --status pending_approval
pnpm --filter @relay/apps-community-engager run actions get <id>
```

Do not hand-edit JSON while the agent is writing.
