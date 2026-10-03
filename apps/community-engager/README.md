# CommunityEngager

First Relay dogfood app: scout allowlisted Reddit fashion/styling threads, draft a reply, **pause for human Approve / Edit / Abort**, then optionally post, then write outcomes to VoltMem.

**Hard rule:** nothing posts without human Approve (`REDDIT_DRY_RUN=true` by default).

Related plans:

- [HITL + CommunityEngager + VoltMem](../../.cursor/plans/relay_hitl_community_voltmem.plan.md) — Phase 5 per-opportunity jobs, Phase 6 subreddit discovery
- [Reddit browser / scrape transport](../../.cursor/plans/relay_reddit_browser.plan.md) — Phase 4b `ensure_session`, Phase 4c anti-bot interstitial
- [ThinkPad deploy](../../.cursor/plans/relay_thinkpad_deploy.plan.md)

## Workflow

Ensure session, pick target subs, scout, queue one job per opportunity, then for each job: draft, you decide, execute only if approved, memory learns.

Dotted edges and *planned* labels are designed but not yet implemented — see the plan links above.

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

  EnsSkip --> Subs
  EnsEnv --> Subs
  EnsLogin --> Subs

  subgraph Targets["1. Target subs"]
    Seed[Static allowlist seed]
    Mem[(VoltMem ranked subs)]
    Subs[Subs to scout]
    Research[Read-only discovery]
    Propose{{HITL approve new sub}}
    Seed --> Subs
    Mem -. planned .-> Subs
    Research -. planned .-> Propose
    Propose -. planned .-> Mem
  end

  Subs --> Src

  subgraph Scout["2. Scout"]
    Src{SCOUT_SOURCE / auto}
    Wall{Anti-bot interstitial?}
    Human[[Human solves challenge · save jar]]
    Blocked[Mark sub blocked · notify · next sub]
    Score[Score ≥ 4 / 5]
    Src -->|browser| SB[Playwright DOM extract]
    Src -->|json| SJ[Public *.json if allowed]
    Src -->|oauth| SO[Reddit API if CLIENT_*]
    Src -->|fail| SF[Fixtures]
    SB --> Wall
    Wall -->|no| Score
    Wall -. headed · planned .-> Human
    Wall -. headless · planned .-> Blocked
    Human -. planned .-> Score
    Blocked -. planned .-> Score
    SJ --> Score
    SO --> Score
    SF --> Score
  end

  Score --> Queue[/Job queue · one runtime per opportunity/]
  Queue --> Job

  subgraph Loop["3. Per-job loop — serial, isolated"]
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
| `ensure_session` | Cookie jar, env login, or HITL `credential` (skipped when dry-run unless `REDDIT_ENSURE_SESSION=true`) |
| `scout` | Find actionable threads (browser → json → oauth → fixtures); *planned:* detect anti-bot interstitial fast and escalate |
| `draft` | Write a reply; may pull VoltMem context |
| `await_approval` | You Approve / Edit / Abort (Telegram or CLI) |
| `execute` | Dry-run log, or live browser/oauth post |
| `learn` | Persist outcome to VoltMem |

`ensure_session` and `scout` run once on the parent manifest. The `jobs` stage **fans out** into the nested `CommunityJobManifest` — one isolated `AgentRuntime` per opportunity. A job that fails or gets aborted is recorded and the queue moves on. Budget with `COMMUNITY_MAX_JOBS` (default 3) and `COMMUNITY_JOB_DELAY_MS` (default 1500).

### Rules that matter

| Rule | Meaning |
|------|--------|
| Nothing posts without Approve | Abort skips execute |
| `REDDIT_DRY_RUN=true` | Safe default — logs only |
| Browser first | Playwright + cookies; OAuth optional backup |
| Allowlist + score ≥4 | Only certain subs / strong fits |
| CAPTCHAs are never auto-solved | Detect, then escalate to a human or degrade quietly |
| Discovery proposes, humans promote | A newly researched sub is not postable until approved |

## Quick start

```bash
# From repo root (Node 22+)
pnpm --filter @relay/engines-browser exec playwright install chromium
cp apps/community-engager/.env.example apps/community-engager/.env
# Set Telegram (or FEEDBACK_ADAPTER=cli), REDDIT_USERNAME/PASSWORD for browser path

pnpm --filter @relay/apps-community-engager build
REDDIT_LOGIN_HEADED=true pnpm --filter @relay/apps-community-engager login:reddit   # once
pnpm --filter @relay/apps-community-engager start
```

See [`.env.example`](./.env.example) for `SCOUT_SOURCE`, `REDDIT_TRANSPORT`, cookie dir, and dry-run flags.
