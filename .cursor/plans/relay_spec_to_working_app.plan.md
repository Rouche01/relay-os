---
name: Relay Spec → working agentic app
overview: "Close the gap between a validated Spec v2 and a truly working agentic app. Compile side exists (scaffold → validate → lower → workflow-runtime → evals); run side is a demo harness (fixtures, stub LLM, network off, fake token, auto-approve). Build a generic Spec host, widen service reach, add app-shaped Spec features (trigger/when/once/retry), real verification (shadow run, generated evals, outcome follow-ups), and package as an installable Relay App. Forcing function: one non-Reddit intent (GitHub bug triage) end-to-end with zero GitHub-specific code outside its descriptor."
todos:
  - id: h0-forcing-intent
    content: "Lock forcing-function intent + success bar — GitHub bug triage (weekday 9am, labeled `bug`, draft triage comment, HITL before post, never twice per issue); write intent.md + expected Spec sketch under apps/ (e.g. apps/triage-gen) as the acceptance fixture"
    status: completed
  - id: h1-spec-host-package
    content: "New @relay/spec-host — extract run logic from relay-shell handleRun + engager-gen host into one generic host: engines built from spec.services/connections (api, llm, data; browser/computer optional), no hardcoded fixtures/services; Desk + engager-gen call it"
    status: pending
  - id: h2-connections-secrets
    content: "Connection resolver — resolve refs like github:default from a secrets store (macOS keychain / .env / file, pluggable); Spec still never holds secrets; validator knownConnections comes from the store; missing connection = structured error"
    status: pending
  - id: h3-live-read-dry-write
    content: "Run modes — `shadow` (live reads, irreversible writes simulated + recorded as evidence), `live` (writes allowed only when budget.dryRun=false AND preceding human.* approved), `fixture` (today’s offline path for CI). Real LLM client in shadow/live"
    status: pending
  - id: h4-real-hitl-resume
    content: "Real HITL — remove auto-approve default; human.* steps surface via Feedback Broker / Desk Console / Telegram; persist run state (context.steps, evidence, cursor) so a paused run resumes after approve/edit/abort, across process restarts"
    status: pending
  - id: h5-run-store
    content: "Run store — runs keyed by specId+specHash: status, timestamps, evidence pack, step outputs, HITL decisions; list/get API for Desk; replay a run from its frozen Spec"
    status: pending
  - id: r1-openapi-import
    content: "OpenAPI → ServiceDescriptor generator (CLI) — select operations, map params/auth, emit YAML that passes service-descriptor schema; mark write methods irreversible by default"
    status: pending
  - id: r2-curated-descriptors
    content: "Curated descriptor pack — github, slack, http.fetch / rss (generic read), plus one of gmail|notion|sheets; live in packages/services (not app-local); loadable by spec-host + scaffolder"
    status: pending
  - id: r3-capability-gaps
    content: "Scaffolder capability-gap result — when intent needs an unknown service/connection, return `needs: [{service|connection, reason}]` instead of burning repair attempts; Desk renders ‘add connection / import descriptor’"
    status: pending
  - id: r4-browser-computer-engines
    content: "Wire browser.* / computer.* engines into workflow-runtime via spec-host (fallback path); same HITL + evidence gating; at least one fixture test per verb family"
    status: pending
  - id: s1-trigger
    content: "Spec v2.1 `trigger` — manual | schedule (cron) | poll (interval + source step); lower onto manifest entrypoints + schedules; @relay/scheduler invokes spec-host; validator + JSON schema + scaffolder prompt updated"
    status: pending
  - id: s2-when
    content: "Spec v2.1 `when:` on steps — whole-ref or simple comparison (eq/ne/in/exists); false → step skipped with evidence; no general expression language"
    status: pending
  - id: s3-once-idempotency
    content: "Spec v2.1 `once: \"${item.id}\"` — idempotency key per step persisted via data engine across runs; duplicates skipped with evidence; required by validator on irreversible forEach steps under a schedule trigger"
    status: pending
  - id: s4-retry-onerror
    content: "Spec v2.1 `retry` (max, backoff) + `onError` (fail | skip_item | escalate_human); irreversible steps never auto-retry without idempotency key"
    status: pending
  - id: s5-output-schema
    content: "Enforce step output schema — llm.generate `schema` and declared `outputs` validated at runtime; mismatch = step failure with evidence (fail closed)"
    status: pending
  - id: v1-generated-evals
    content: "Scaffolder emits eval fixtures + acceptance cases alongside the Spec (not deskEvalFixtures heuristics); spec-evals runs them as the pre-freeze gate"
    status: pending
  - id: v2-shadow-gate
    content: "Shadow-run gate — enabling a scheduled Spec requires ≥1 shadow run whose evidence pack a human approved; Desk shows evidence + simulated writes side by side"
    status: pending
  - id: v3-outcome-followups
    content: "Outcome rules become scheduled follow-up entrypoints (e.g. metric after 48h) that record results to the run store / VoltMem; surfaced per app"
    status: pending
  - id: v4-live-llm-parity
    content: "Live-LLM scaffold + draft parity vs CommunityEngager (PARITY.md): mean draft-judge within 0.5 on shared fixtures; record scaffold success rate over N intents"
    status: pending
  - id: p1-relay-app-bundle
    content: "Relay App bundle format — frozen Spec + lowered manifest + specHash + descriptors + required connections + evals + trigger; content-addressed; export/import"
    status: pending
  - id: p2-desk-app-lifecycle
    content: "Desk app lifecycle — install bundle → connect → shadow run → enable → pause/disable → view runs/outcomes; thaw-to-edit re-requires evals + shadow gate"
    status: pending
  - id: e2e-triage-demo
    content: "E2E cold demo — plain-text triage intent → scaffold → freeze → shadow run against real GitHub → approve → enable schedule → next tick posts after HITL; no duplicate comments on re-run; checklist in docs/"
    status: pending
isProject: true
---

# Relay — Spec → working agentic app

Follow-on to [`relay_intent_spec_verify_hitl.plan.md`](./relay_intent_spec_verify_hitl.plan.md) (thesis loop, done) and the Spec v2 pipeline (`spec-scaffold`, `spec-validator`, `spec-lower`, `workflow-runtime`, `spec-evals`, `engines-*`).

**Problem:** we can compile Intent → Spec v2 → manifest, but nothing that compiles actually *runs as an app*.

## Diagnosis (2026-10-30)

| Gap | Today | Evidence |
|-----|-------|----------|
| Run is a harness | Desk `handleRun` injects hardcoded Reddit posts, stub LLM, `fetch` throws, fake bearer token, auto-approves HITL | `apps/relay-shell/server/spec-v2.ts` |
| Reach | Only `reddit-public` / `reddit-oauth` descriptors; scaffolder (correctly) may not invent ops; Desk wires only `api`/`llm`/`data` engines — `browser.*`/`computer.*` unreachable | `apps/engager-gen/services/`, `handleRun` engines |
| Language = one pass | `SpecV2Body` = goal, connections, services, budget, rules, linear steps + `forEach`. No trigger, conditionals, cross-run state, retry | `packages/protocol/src/spec-v2.ts` |
| No durability | One in-process run per HTTP call; no saved run, no HITL pause/resume, outcome rules never measured | `handleRun`, `createWorkflowRuntime` |
| Weak proof | Desk synthesizes eval fixtures from the Spec (`deskEvalFixtures`); parity with CE still stub-only | `PARITY.md` |

## Definition of “truly working”

> A frozen Spec that **runs on a trigger** against **real services**, **pauses for a real human**, **survives restarts**, and **reports outcomes** — with no app-specific code outside service descriptors.

## Principles

- **One generic host.** No per-app hosts (engager-gen and Desk each wiring their own is the per-app-compiler anti-pattern again).
- **Closed language.** Widening reach = more descriptors + primitives, not LLM-written code. A sandboxed `code.run` escape hatch is deferred.
- **Reuse what exists.** Triggers lower onto manifest `entrypoints`/`schedules` + `@relay/scheduler` (done in [`relay_manifest_entrypoints_schedules.plan.md`](./relay_manifest_entrypoints_schedules.plan.md)); state on `engines-data`; HITL on Feedback Broker.
- **Fail closed, prove before enable.** Shadow run + human-approved evidence before any schedule fires live writes.
- **Forcing function over generality claims.** Done = the GitHub triage intent works with zero GitHub-specific code outside its descriptor.

## Forcing-function intent

> *Every weekday at 9am, find new GitHub issues labeled `bug` in repo X, draft a triage comment for each, ask me before posting, and never comment on the same issue twice.*

**Locked fixture:** [`apps/triage-gen/`](../../apps/triage-gen/) — `intent.md`, `SUCCESS.md`, `spec.expected.yaml`, `services/github.yaml`, `fixtures/issues.json`. Slots: `acme/widgets`, label `bug`, cron `0 9 * * 1-5`, connection `github:default`. No per-app host (generic `@relay/spec-host` later).

Exercises: OpenAPI import, real connection, `trigger`, `once`, HITL pause/resume, live read + gated write, generic host.

Canonical Spec sketch lives in [`apps/triage-gen/spec.expected.yaml`](../../apps/triage-gen/spec.expected.yaml) (v2.1 fields annotated). Condensed:

```yaml
goal: Triage new bug issues in acme/widgets with a helpful first comment
connections: [github:default]
services: [github]
trigger: { schedule: { cron: "0 9 * * 1-5" } }   # v2.1
budget: { maxJobs: 10, dryRun: true }
rules:
  - id: no_promo_links
    kind: hard
    check: { notMatches: "${draft.text}", pattern: "https?://" }
steps:
  - id: scout
    use: api.request
    args: { service: github, operation: issuesListForRepo, params: { owner: acme, repo: widgets, labels: bug, state: open } }
  - id: draft
    use: llm.generate
    forEach: "${steps.scout.output.body}"
    once: "${item.number}"                         # v2.1
    args: { prompt: "…", input: "${item}", schema: { … } }
    enforce: [no_promo_links, triage_quality]
  - id: approve
    use: human.approve
    args: { show: "${steps.draft.output}" }
  - id: post
    use: api.request
    forEach: "${steps.draft.output}"
    once: "${item.issue_number}"                   # v2.1
    retry: { max: 2 }                              # v2.1
    args: { service: github, operation: issuesCreateComment, connection: github:default, method: POST, params: { … } }
```

## Target loop

```text
Intent ──scaffold──► Spec v2.1 + evals (+ capability gaps → add connection/descriptor)
                        │ validate + evals gate
                     freeze ──► Relay App bundle
                        │
                  shadow run (live reads, simulated writes)
                        │ evidence pack ──► human approves
                     enable trigger ──► @relay/scheduler
                        │
             spec-host run (persisted) ──► human.* pause ⇄ resume
                        │
              gated live writes (once/retry) ──► run store
                        │
              outcome follow-ups ──► metrics / VoltMem
```

## Phases (work order)

### Phase H — Generic Spec host (make the run real)

1. **`h0-forcing-intent`** — lock the triage intent + success bar first so every phase has a concrete target.
2. **`h1-spec-host-package`** — `@relay/spec-host`: `runSpec({ frozen, mode, connections, hitl, store })`. Desk `handleRun` and `engager-gen` become thin callers.
3. **`h2-connections-secrets`** — pluggable secrets resolver; Spec refs only.
4. **`h3-live-read-dry-write`** — `fixture` | `shadow` | `live` modes; fixtures stay for CI.
5. **`h4-real-hitl-resume`** — persisted pause/resume through Feedback Broker; auto-approve only in `fixture` mode.
6. **`h5-run-store`** — runs + evidence addressable by id; Desk lists them.

**Exit:** the existing CE-lite `spec.yaml` runs in `shadow` mode against live `reddit-public` with a real LLM and a real Desk approval, and resumes after a restart.

### Phase R — Reach (services + engines)

7. **`r1-openapi-import`** — highest leverage; GitHub is the first import.
8. **`r2-curated-descriptors`** — shared `packages/services`.
9. **`r3-capability-gaps`** — scaffolder says what's missing instead of failing three repairs.
10. **`r4-browser-computer-engines`** — fallback path wired, same gating.

**Exit:** the triage intent scaffolds to a valid Spec (or a precise `needs:` list that, once satisfied, validates).

### Phase S — Spec v2.1 (app-shaped language)

11. **`s1-trigger`** → 12. **`s3-once-idempotency`** → 13. **`s2-when`** → 14. **`s4-retry-onerror`** → 15. **`s5-output-schema`**

Each addition: protocol type + JSON schema + validator rule + lowerer + runtime + scaffolder prompt + test. Keep additive (v2 Specs remain valid).

**Exit:** triage Spec lowers to a scheduled entrypoint; re-running the same tick produces zero duplicate writes.

### Phase V — Verification that matters

16. **`v1-generated-evals`** → 17. **`v2-shadow-gate`** → 18. **`v3-outcome-followups`** → 19. **`v4-live-llm-parity`**

**Exit:** a scheduled Spec cannot go live without a human-approved shadow evidence pack; outcome rule results appear per run.

### Phase P — Package + lifecycle

20. **`p1-relay-app-bundle`** → 21. **`p2-desk-app-lifecycle`** → 22. **`e2e-triage-demo`**

**Exit:** cold demo below passes.

## Acceptance criteria (plan done)

- [ ] No hardcoded services, fixtures, or tokens in Desk’s run path; Desk + engager-gen both use `@relay/spec-host`
- [ ] Connections resolve from a secrets store; missing connection is a structured, actionable error
- [ ] `shadow` mode performs live reads and records simulated writes as evidence
- [ ] A run paused at `human.*` resumes after approve/edit/abort, including across a process restart
- [ ] GitHub descriptor generated from OpenAPI (not hand-written) and used by the triage Spec
- [ ] Scaffolder returns capability gaps instead of looping on unknown services
- [ ] Spec v2.1 `trigger`, `when`, `once`, `retry`/`onError` validated, lowered, and enforced at runtime
- [ ] Enabling a schedule requires an approved shadow run
- [ ] Outcome rules measured by scheduled follow-ups
- [ ] Relay App bundle exportable/importable; Desk install → shadow → enable → pause works
- [ ] E2E triage demo: plain text → live scheduled app, HITL before every post, no duplicate comments, no GitHub-specific code outside the descriptor

## Non-goals

- LLM-generated code / unbound stage invention (closed catalog stays)
- Multi-tenant hosting, marketplace, or billing for Relay Apps
- Rewriting CommunityEngager onto spec-host (optional later; CE stays the browser dogfood)
- General expression language in `when:`
- Formal verification (research-lab)
- Local computer runtime bundling ([`relay_desk_local_runtime.plan.md`](./relay_desk_local_runtime.plan.md) stays separate)

## Risks

| Risk | Mitigation |
|------|------------|
| Scaffolder quality on unfamiliar services | Capability-gap path + generated evals + `v4` success-rate tracking |
| OpenAPI specs are huge / messy | Operation selection in import CLI; curated pack as fallback |
| HITL resume complexity in AgentRuntime | Persist minimal cursor (stage index, steps bag, evidence); resume = re-hydrate, not replay |
| Idempotency bugs cause duplicate public writes | Validator requires `once` on scheduled irreversible forEach; shadow gate; dry-run default stays |

## Suggested build slice order

| Priority | Todo ids | Why |
|----------|----------|-----|
| P0 | `h0-forcing-intent`, `h1-spec-host-package`, `h2-connections-secrets`, `h3-live-read-dry-write` | Nothing is “real” until the host is |
| P0 | `h4-real-hitl-resume`, `h5-run-store` | Apps must pause for humans and survive restarts |
| P1 | `r1-openapi-import`, `r3-capability-gaps`, `r2-curated-descriptors` | Reach beyond Reddit |
| P1 | `s1-trigger`, `s3-once-idempotency` | Minimum for a scheduled app that is safe to re-run |
| P2 | `s2-when`, `s4-retry-onerror`, `s5-output-schema`, `r4-browser-computer-engines` | Robustness + fallback path |
| P2 | `v1-generated-evals`, `v2-shadow-gate`, `v3-outcome-followups`, `v4-live-llm-parity` | Proof before enable |
| P3 | `p1-relay-app-bundle`, `p2-desk-app-lifecycle`, `e2e-triage-demo` | Product shape + demo |

## Tracking

YAML `todos` above are the source of truth. Append dated notes under **Log**; do not rewrite history.

## Log

### 2026-10-30

- Opened plan from gap review: compile side done; run side is a fixture/stub/auto-approve harness in `relay-shell` `handleRun`. Agreed direction: generic spec-host → reach (OpenAPI import, capability gaps) → Spec v2.1 (trigger/when/once/retry) → shadow-gated verification → Relay App bundle. Forcing function: GitHub bug triage intent.
- **`h0-forcing-intent` completed** — added [`apps/triage-gen/`](../../apps/triage-gen/): locked `intent.md` (slots `acme/widgets`, `bug`, weekday 09:00), `SUCCESS.md` bar, `spec.expected.yaml` (v2.1 annotated), hand `services/github.yaml` (list + comment), `fixtures/issues.json`. Explicitly no host package — waits on `h1-spec-host-package`.
