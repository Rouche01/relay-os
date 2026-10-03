---
name: Relay HITL + CommunityEngager + VoltMem
overview: "Build and harden Relay’s HITL agent runtime dogfood: protocol/runtime, Feedback Broker, CommunityEngager (GoStylens Reddit ops), Telegram adapter, VoltMem context engine. Product shell (living todo) is a separate plan."
todos:
  - id: p0-protocol-harden
    content: Harden @relay/protocol — abort/edit actions, optional feedback, richer FeedbackRequest context (community draft types live in apps/community-engager)
    status: completed
  - id: p0-runtime-harden
    content: Harden AgentRuntime — honor abort, freeform edit, skip optional feedback, persist WAITING_USER, stage context bag
    status: completed
  - id: p0-feedback-broker
    content: packages/feedback-broker — in-process broker that routes FeedbackRequest ↔ adapters; CLI adapter first
    status: completed
  - id: p0-action-store
    content: "packages/action-store — ActionStore port + FileJson driver; Postgres-ready factory"
    status: completed
  - id: p1-telegram-adapter
    content: packages/adapters-telegram — Approve / Edit / Abort mapped to FeedbackResponse; allowlisted user only
    status: completed
  - id: p1-community-app
    content: apps/community-engager — manifest + scout/draft/approve/execute stages; port types from stylens-ops
    status: completed
  - id: p1-scout-draft-stub
    content: Scout/drafter v1 with fixtures or mock threads; score ≥4 gate; intensity 0–1 default; no Reddit write yet
    status: completed
  - id: p1-e2e-cli-hitl
    content: E2E — spawn CommunityEngager → CLI/Telegram feedback → abort or approve → status transitions logged
    status: completed
  - id: p2-voltmem-context
    content: packages/context-engine — VoltMem client wrapper (fail-open); profile for relay/community domains
    status: completed
  - id: p2-memory-write-read
    content: Write aborts/approvals/intensity outcomes to VoltMem; inject memory into drafter prompts
    status: completed
  - id: p2-reddit-read
    content: Wire Reddit read-only scout (allowlisted subs); respect sub rules; refuse low scores
    status: completed
  - id: p2-executor
    content: Reddit submit only after approved/edited; intensity-2 requires confirmation; UTM + idempotent job ids
    status: completed
  - id: p3-deploy-ops
    content: "Deploy path — owned by relay_thinkpad_deploy.plan.md (namespaced ThinkPad tree, VoltMem, systemd among other services, deploy/ runbook) — LIVE 2026-10-01"
    status: completed
  - id: p3-measure
    content: PostHog UTMs on intensity-2; log outcomes; close Notion community experiment with evidence
    status: pending
  - id: p4-product-slice
    content: Productize — SDK surface, second adapter or second app stub; decide Relay vs stylens-ops ownership (README living-todo story points at shell plan)
    status: pending
  - id: p4a-manifest-driven-engines
    content: "Declarative engines: manifest truth for stage.engine + engines_required; runtime validates/binds from registry (no stub map in index); controller = policy only; align scout/execute with browser; pairs with ensure_session in reddit browser plan"
    status: completed
isProject: true
---

# Relay OS — HITL runtime + CommunityEngager + VoltMem

Canonical plan for the **runtime dogfood** (protocol → CommunityEngager → Telegram → VoltMem → Reddit). Open while the `relay-os` workspace is active.

**Product shell (living todo queue + in-card HITL):** see separate plan [`relay_living_todo_shell.plan.md`](./relay_living_todo_shell.plan.md).

## Product framing

**Layman differentiation (canonical copy):** root [`README.md`](../../README.md).

> n8n: wire systems; optionally ask a human before this node.  
> Loops: run an agent in a disciplined cycle until gates pass.  
> Relay: run an agent that negotiates with a human through a protocol, then acts.

| Piece | Role | Remains separate? |
|-------|------|-------------------|
| **Relay runtime** | Protocol, runtime, feedback broker, engines | This product (infra) |
| **VoltMem** | Current-truth memory (`@voltmem/client` + sidecar) | Yes — `~/Projects/voltmem` |
| **CommunityEngager** | First agentic app (Reddit scout → draft → approve → post) | First-party app; thin deploy may stay in `stylens-ops` |
| **gostylens-harness** | Voice, ICP, experiment design | Yes — strategy only |
| **Living todo shell** | Priority agent job queue + in-card feedback | Separate plan |

**Hard rule (community):** nothing posts without human Approve (Edit allowed; Abort is first-class).

**Non-goals (this plan):** living todo UI, fake desktop OS, free-form plan→manifest, Newsletter Migrator rewrite, agent marketplace. Those belong to the shell plan or later work.

## Why this path

- Dogfood Relay where HITL is mandatory (brand + ToS risk).
- Prove Feedback Broker + stages before / alongside the living-todo shell.
- VoltMem fills Context Engine as a real dependency.
- CommunityEngager becomes the first **job type** the living-todo plan plugs into.

## Current state (baseline)

Already in `relay-os` (Phases 0–2 landed; Phase 3 **deploy** done):

- Monorepo: protocol, runtime, feedback-broker, adapters-telegram, action-store, context-engine, llm-controller, engines-browser
- `apps/community-engager` dogfood path
- Skeleton `apps/newsletter-migrator` (parked)
- **ThinkPad dogfood LIVE** — see [`relay_thinkpad_deploy.plan.md`](./relay_thinkpad_deploy.plan.md): `/opt/voltmem` + `/opt/relay-community`, Telegram HITL, systemd/timer, `deploy/` runbook

Still open here: **measure** (Phase 3 remainder), product/ownership polish (Phase 4).

Siblings: `stylens-ops`, `voltmem`, `gostylens-harness`. Host also runs Beszel (monitoring; outside this plan).

## Target architecture

```mermaid
flowchart TB
  subgraph relay [relay-os]
    RT[AgentRuntime]
    FB[FeedbackBroker]
    CE[ContextEngine]
    APP[CommunityEngager]
    TG[TelegramAdapter]
    CLI[CLIAdapter]
    STORE[ActionStore]
  end

  subgraph external [siblings]
    VM[VoltMem_sidecar]
    RD[Reddit_API]
    HAR[gostylens-harness]
  end

  APP --> RT
  RT --> FB
  FB --> TG
  FB --> CLI
  RT --> STORE
  CE --> VM
  APP -->|scout_execute| RD
  APP --> HAR
  APP --> CE
```

Living-todo queue and in-card UI attach to `FB` / `APP` in the [shell plan](./relay_living_todo_shell.plan.md).

### CommunityEngager stage map

Compact stage list (see the full scout → HITL → execute diagram in [`apps/community-engager/README.md`](../../apps/community-engager/README.md)):

```mermaid
flowchart LR
  scout[scout]
  draft[draft]
  hitl[await_approval]
  exec[execute]
  learn[learn]

  scout --> draft --> hitl
  hitl -->|approve_or_edit| exec
  hitl -->|abort| learn
  exec --> learn
  learn -->|VoltMem write| done[COMPLETE]
```

| Stage | Engine | Feedback |
|-------|--------|----------|
| `scout` | `api` or `llm` (+ later browser) | `progress` (optional) |
| `draft` | `llm` | — |
| `await_approval` | — (broker only) | `approval` + `freeform` edit; intensity-2 → extra `confirmation` |
| `execute` | `api` (Reddit submit) | `error` on failure |
| `learn` | `data` / context | write outcomes to VoltMem |

## Implementation phases

### Phase 0 — Protocol & runtime — done

Abort/edit/optional feedback; feedback broker + CLI; action store.

### Phase 1 — Telegram + CommunityEngager — done

Telegram adapter + community app + fixture scout/draft E2E.

### Phase 2 — VoltMem + Reddit — done

Context engine + memory write/read + Reddit read + gated executor.

### Phase 3 — Deploy & measure

**Deploy — done (2026-10-01):** [`relay_thinkpad_deploy.plan.md`](./relay_thinkpad_deploy.plan.md)

1. ~~Namespaced ThinkPad root + VoltMem sidecar + Telegram HITL via systemd (one service among many)~~
2. ~~Land `deploy/` runbook/units in this repo; stylens-ops deploy notes are historical only~~
3. PostHog UTMs on intensity-2; harness taxonomy events (`p3-measure`) — **next**
4. Close Notion experiment with evidence

**Deploy exit criteria:** met (scheduled/timer runs on ThinkPad; Telegram HITL without laptop babysitting session). Cloudflare webhook remains a later escape hatch if needed.

### Phase 4 — Product slice (docs / ownership)

1. README points at both this plan and the living-todo shell plan
2. Document adapter + app SDK surfaces
3. Optional second adapter or thin second app stub
4. Decide `stylens-ops` → deploy-only vs archive
5. Monetization deferred

**Exit criteria:** New agentic app + Telegram HITL without reading stylens-ops.

### Phase 4a — Manifest-driven engines (declarative > imperative)

**Status:** shipped — `bindEngines()` in `@relay/runtime`; CommunityEngager uses `createCommunityEngines()` (Playwright + llm draft + data/VoltMem; api optional); stubs removed; AgentRuntime asserts engines on construct.

**Thesis:** The manifest should be the source of truth for *what* runs (stages, engines, feedback). Host `index.ts` should not hand-roll a stub `engines` map that ignores real work. Controller keeps *policy* (score gate, Approve, dry-run, memory writes) — not reinventing transport.

**Why now:** CommunityEngager already does scout/execute via Playwright + Reddit helpers while the manifest still says `engine: "api"` and `index.ts` injects stubs that the controller ignores (`_engine`). That drift fights the Relay story (“agent negotiates through a protocol”).

**Do (in scope)**

| Change | Detail |
|--------|--------|
| Manifest truth | Align `stage.engine` + `engines_required` with reality (`browser` for scout/execute once primary; `llm` draft; `data` learn; `none` HITL; add `ensure_session` + `credential` per reddit browser Phase 4b) |
| Runtime bind | Validate provided engines ⊇ `engines_required`; optional **engine registry/factory** so apps pass factories once, runtime fills from manifest |
| Thin host | `CommunityEngagerApp` stops constructing stub api/llm/data unless a stage truly has no backend |
| Controller role | `onStageStart` orchestrates domain logic *using* the resolved engine when useful; no parallel “secret” I/O path that contradicts `stage.engine` |

**Don’t (out of scope / anti-pattern)**

- Encoding score thresholds, allowlists, or draft prompts as opaque manifest JSON — those stay typed modules
- Making the manifest a full workflow DSL (n8n clone) — stages + engines + feedback_points is enough
- Blocking ThinkPad smoke / dry-run dogfood on a perfect registry — ship 4b + smoke first if needed; 4a can land in parallel

**Suggested shape (sketch)**

```ts
// Host supplies implementations (or factories), not one-off stubs
const engines = bindEngines(CommunityEngagerManifest, {
  browser: () => new PlaywrightEngine(/* … */),
  llm: () => createLlmEngine(/* … */),  // or keep draft in controller until LLM engine exists
  data: () => createDataEngine(memory),
  api: () => createRedditApiEngine(/* optional OAuth */),
});

new AgentRuntime(manifest, engines, ctx, controller);
```

Runtime: on start, assert every `engines_required` key exists; `resolveEngine` unchanged.

**Order relative to reddit browser plan:** implement alongside or right after **Phase 4b `ensure_session`** (credential HITL is itself manifest-declared). Prefer fixing `stage.engine` labels when adding `ensure_session` so we don’t add another stub.

**Exit criteria:** No unused stub engines for required stages; `manifest.stages[].engine` matches the code path that actually runs; second app can copy the pattern without reading CommunityEngager internals.

## Suggested package / app layout

```text
relay-os/
├── apps/
│   ├── community-engager/     ← this plan
│   ├── living-todo/           ← shell plan
│   └── newsletter-migrator/   ← parked
├── packages/
│   ├── protocol/
│   ├── runtime/
│   ├── feedback-broker/
│   ├── adapters-telegram/
│   ├── context-engine/
│   ├── action-store/
│   ├── llm-controller/
│   └── engines-browser/
└── .cursor/plans/
    ├── relay_hitl_community_voltmem.plan.md  ← this file
    ├── relay_thinkpad_deploy.plan.md         ← ThinkPad dogfood (LIVE)
    └── relay_living_todo_shell.plan.md
```

## Implementation order (this plan)

1. ~~Protocol + runtime~~
2. ~~Broker + CLI + action store~~
3. ~~CommunityEngager + Telegram~~
4. ~~VoltMem + Reddit~~
5. ~~Deploy (ThinkPad)~~ → **measure** (open)
6. ~~Manifest-driven engines (Phase 4a)~~ + ~~reddit browser 4b ensure_session~~
7. Product slice / ownership / measure
8. ThinkPad deploy slice + smoke (reddit browser plan)

Then continue in [`relay_living_todo_shell.plan.md`](./relay_living_todo_shell.plan.md).

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Three repos stall progress | Freeze newsletter migrator; one community vertical here |
| Reddit API / policy blocks write | HITL + fixtures + dry-run first; write last; browser/JSON transport → [`relay_reddit_browser.plan.md`](./relay_reddit_browser.plan.md) |
| VoltMem profile mismatch | Fail-open; free-text facts; tune domains later |
| Duplicate bots in stylens-ops + Relay | Single Telegram adapter in Relay |
| Mixing shell scope into this plan | Living todo tracked only in shell plan |

## Success criteria (this plan)

- [x] Abort is first-class and prevents execute
- [x] Edit updates draft before post
- [x] Telegram is only a Feedback Broker adapter
- [x] VoltMem influences at least one subsequent draft
- [x] Approved posts only via executor after `approved`/`edited`
- [x] Deploy path documented / running (ThinkPad — [`relay_thinkpad_deploy.plan.md`](./relay_thinkpad_deploy.plan.md))
- [ ] Measure path closed with evidence (PostHog UTMs + Notion experiment)
- [ ] stylens-ops ownership decided

## Related

- Reddit browser / scrape transport (no API app): [`relay_reddit_browser.plan.md`](./relay_reddit_browser.plan.md) — **4b ensure_session** + **4a engines** done; next: deploy/smoke
- ThinkPad deploy: [`relay_thinkpad_deploy.plan.md`](./relay_thinkpad_deploy.plan.md)
- Living todo shell: [`relay_living_todo_shell.plan.md`](./relay_living_todo_shell.plan.md)
- README: [`README.md`](../../README.md)
- Architecture: [`ARCHITECTURE.md`](../../ARCHITECTURE.md)
- stylens-ops plan: `~/Projects/stylens-ops/.cursor/plans/stylens_ops_community_hitl.plan.md`
- VoltMem sidecar: `~/Projects/voltmem/docs/SIDECAR.md`
- Notion experiment: Community HITL — Reddit fashion/styling → installs
