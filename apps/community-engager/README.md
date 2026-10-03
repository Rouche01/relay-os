# CommunityEngager

First Relay dogfood app: scout allowlisted Reddit fashion/styling threads, draft a reply, **pause for human Approve / Edit / Abort**, then optionally post, then write outcomes to VoltMem.

**Hard rule:** nothing posts without human Approve (`REDDIT_DRY_RUN=true` by default).

Related plans:

- [HITL + CommunityEngager + VoltMem](../../.cursor/plans/relay_hitl_community_voltmem.plan.md)
- [Reddit browser / scrape transport](../../.cursor/plans/relay_reddit_browser.plan.md) — Phase 4b `ensure_session` (credential via Telegram/CLI)
- [ThinkPad deploy](../../.cursor/plans/relay_thinkpad_deploy.plan.md)

## Workflow

Ensure session (cookie jar, env, or HITL login), scout finds, draft proposes, you decide, execute only if approved, memory learns.

```mermaid
flowchart TD
  Start([Start CommunityEngager]) --> EnsJar

  subgraph Ens["0. Ensure session"]
    EnsJar{Cookie jar?}
    EnsJar -->|yes| EnsSkip[Skip]
    EnsJar -->|env user/pass| EnsEnv[Env login]
    EnsJar -->|else| EnsCred[credential FeedbackRequest]
    EnsCred --> EnsLogin[Playwright login + save jar]
    EnsEnv --> S1
    EnsSkip --> S1
    EnsLogin --> S1
  end

  subgraph Scout["1. Scout"]
    S1[Allowlisted fashion subs]
    S2{SCOUT_SOURCE / auto}
    S2 -->|browser| SB[Playwright DOM extract]
    S2 -->|json| SJ[Public *.json if allowed]
    S2 -->|oauth| SO[Reddit API if CLIENT_*]
    S2 -->|fail| SF[Fixtures]
    SB --> Score
    SJ --> Score
    SO --> Score
    SF --> Score
    Score[Score ≥ 4 / 5] --> Opp[Top opportunities]
  end

  S1 --> S2
  Opp --> Draft

  subgraph Draft["2. Draft"]
    D1[Pick top thread]
    D2[Drafter + VoltMem context]
    D3[Draft reply text]
    D1 --> D2 --> D3
  end

  Draft --> HITL

  subgraph HITL["3. Await approval — hard gate"]
    H1[Telegram or CLI]
    H2{Human decision}
    H1 --> H2
    H2 -->|Approve| OK[status = approved]
    H2 -->|Edit: …| ED[Update draft text]
    H2 -->|Abort| AB[Stop — no post]
    ED --> OK
  end

  OK --> Exec
  AB --> LearnAbort[Learn: write abort to VoltMem]
  LearnAbort --> EndAbort([Done — nothing posted])

  subgraph Exec["4. Execute"]
    DryQ{REDDIT_DRY_RUN?}
    DryQ -->|true default| DR[Log would-post only]
    DryQ -->|false| TxQ{Transport chain}
    TxQ -->|browser| EB[Cookie jar / login → comment on thread]
    TxQ -->|oauth fallback| EO[API comment if CLIENT_*]
    EB --> Posted[Permalink + job id]
    EO --> Posted
    DR --> Job[Idempotent job file]
    Posted --> Job
  end

  Job --> Learn

  subgraph Learn["5. Learn"]
    L1[Write outcome to VoltMem]
    L2[Influences future drafts]
    L1 --> L2
  end

  Learn --> End([Done])
```

### Stages (short)

| Stage | What happens |
|-------|----------------|
| `ensure_session` | Cookie jar, env login, or HITL `credential` (skipped when dry-run unless `REDDIT_ENSURE_SESSION=true`) |
| `scout` | Find actionable threads (browser → json → oauth → fixtures) |
| `draft` | Write a reply; may pull VoltMem context |
| `await_approval` | You Approve / Edit / Abort (Telegram or CLI) |
| `execute` | Dry-run log, or live browser/oauth post |
| `learn` | Persist outcome to VoltMem |

### Rules that matter

| Rule | Meaning |
|------|--------|
| Nothing posts without Approve | Abort skips execute |
| `REDDIT_DRY_RUN=true` | Safe default — logs only |
| Browser first | Playwright + cookies; OAuth optional backup |
| Allowlist + score ≥4 | Only certain subs / strong fits |

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
