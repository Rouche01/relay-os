---
name: App knowledge store + MCP
overview: "Elevate Relay from act-only to act + durable, Spec-scoped knowledge. MCP/API is an opt-in owner capability to expose selected knowledge / side effects as a service — not the default for every app. Dogfood with a scheduled creator-sourcing Spec that HITL-stages candidates and syncs/exports into Creatuuls catalog — Find never reads Relay as live index."
todos:
  - id: ak0-thesis
    content: Lock thesis — runs leave queryable memory; Knowledge is Spec-scoped evidence + records; MCP/API is opt-in over that store (and declared exportable side effects); not a second marketplace DB for products like Creatuuls Find; default app is run-only
    status: pending
  - id: ak1-knowledge-model
    content: Define KnowledgeRecord / KnowledgeCollection types (appId, runId, kind, payload, evidence refs, confidence, status pending|approved|rejected) + retention/TTL policy for job metadata vs durable entities
    status: pending
  - id: ak2-write-path
    content: Spec primitives or bindings to write knowledge only when Spec allows; irreversible catalog-class writes require HITL; shadow runs write to shadow namespace only
    status: pending
  - id: ak3-query-mcp
    content: Opt-in per-app (or per-installed Spec) MCP/API — list/query/get/export knowledge and any owner-declared exportable side effects; auth scoped to Desk owner / connection; document read vs mutate tools; no auto-publish of whole workflows
    status: pending
  - id: ak4-creatuuls-dogfood-spec
    content: Scheduled creator-sourcing Spec — YouTube (then CSV/other) → classify niches/markets → stage knowledge → HITL → export/sync to Creatuuls seed approve path; MVP markets US + Nigeria
    status: pending
  - id: ak5-creatuuls-boundary
    content: Document boundary — Relay owns sourcing memory; Creatuuls owns Find catalog (creators/outlets); sync is one-way import; no Find→Relay live query
    status: pending
  - id: ak6-desk-surface
    content: Thin Desk UX — Apps show Knowledge tab or Activity → queryable records for that app; link Run evidence to records
    status: pending
isProject: true
---

# App knowledge store + query MCP (medium-term)

Sibling of long-term [`relay_open_services_platform.plan.md`](./relay_open_services_platform.plan.md) and short-term [`relay_desk_closed_loop_asap.plan.md`](./relay_desk_closed_loop_asap.plan.md). Does **not** replace ASAP closed loop.

## Thesis

Today Relay optimizes **act for me** (Intent → Spec → prove → run → HITL). Elevate to:

> **Don’t just act for me — leave information I can retrieve from what you did.**

**Default:** an installed app is a run-only operational loop (optional durable knowledge for the owner).

**Optional capability:** the app owner may expose an **API or MCP** when a workflow produces a side effect or durable result they want other clients to call. Exposure is declared per output / side effect under Spec + auth rules — not auto-wrapped for every Spec.

Knowledge query and service export are related faces of the same opt-in surface (read memory; gated mutate / sync when the owner opts in).

## Why this exists

| Without knowledge | With knowledge |
| --- | --- |
| Run completes; evidence is ephemeral / hard to reuse | Runs accumulate Spec-scoped records |
| Other systems re-scrape or re-ask | MCP/API: query what this app already learned |
| HITL only gates side effects | HITL also gates what enters durable memory |

This is platform capability first; vertical dogfoods second.

## Architecture (locked)

```text
Intent → Spec → run
              │
              ├─ act (API / MCP / computer)     existing
              └─ write KnowledgeRecord          new (Spec-allowed)
                        │
                        ▼
              Knowledge store (per app / Spec)
                        │
         ┌──────────────┼──────────────────────────┐
         ▼              ▼                          ▼
    Desk query    App MCP/API (opt-in)      Downstream sync
    (operator)    owner-declared exports    (e.g. Creatuuls import)
```

**Creatuuls dogfood boundary (explicit):**

```text
Relay scheduled Spec
  source → classify → HITL → Knowledge (candidates + evidence)
       │
       │  MCP export / webhook / CLI sync
       ▼
Creatuuls seed approve / upsert
  creators + outlets
       │
       ▼
Creatuuls Find  ← ONLY reads Creatuuls Neon
```

- **Relay** owns *sourcing memory* (runs, classifier scores, pending/approved candidates, evidence).
- **Creatuuls** owns *marketplace catalog* (Find, claim, offers, rates).
- Find must **not** live-query Relay. Sync/import only (aligns with Creatuuls M6d CLI pipeline).

## In scope

1. **Knowledge model** — records tied to `appId` / Spec / `runId`; kinds e.g. `creator_candidate`, `classification`, `export_batch`; status + confidence; link to evidence pack artifacts.
2. **Write rules** — only via Spec-allowed actions; shadow ≠ live namespace; HITL before “approved” / export when Spec marks irreversible.
3. **Opt-in query / service surface** — MCP and/or HTTP for list/filter/get/export of knowledge and owner-declared exportable side effects; scoped credentials; no open world by default.
4. **Dogfood Spec** — scheduled creator sourcing (YouTube first; CSV/manual path OK): niche/market classify → stage → HITL → sync into Creatuuls (`seed:pipeline` / `seed:approve` or thin API). MVP markets: **United States**, **Nigeria**.
5. **Desk** — minimal operator view of knowledge for an installed app; clear enable path when owner opts into MCP/API export.

## Out of scope

- Creatuuls Find reading Relay as the live index
- Replacing Creatuuls Neon catalog with Relay storage
- General customer “upload any DB” marketplace
- Full open-services inference of bindings (see open services plan)
- Auto-approve into Creatuuls without Spec/HITL policy
- Auto-publishing every workflow as a public API/MCP service
- Synchronous “call whole Spec as one RPC” without declaring exportable outputs / HITL contract
- IG/TikTok/X adapters as a platform requirement (may follow as Spec sources later)

## Locked choices

| Choice | Decision |
| --- | --- |
| Elevation | Act + durable Spec-scoped knowledge + retrieve |
| Default app | Run-only (+ optional knowledge for the owner); no MCP/API required |
| Exposure | Opt-in — owner declares which knowledge / side effects are exportable as MCP/API |
| Exposure unit | Selected outputs / side effects, not the whole workflow by default |
| Creatuuls | Downstream consumer via sync; Find stays on Creatuuls DB |
| Classification | AI/hybrid labels candidates in Relay; human/HITL before export |
| TTL | Job/run metadata may expire; approved entity records persist until explicit prune |

## Success criteria

1. An installed Spec can write knowledge on run; the owner can query it from Desk; MCP/API only after opt-in for declared exports.
2. Creator-sourcing Spec produces HITL-approved candidate batches and syncs them into Creatuuls so Find shows niches/markets correctly.
3. Docs state the boundary clearly: Relay memory ≠ Creatuuls catalog; default app ≠ public service.
4. Shadow runs never pollute live knowledge or Creatuuls.

## Suggested sequencing

1. `ak0`–`ak1` — thesis + types  
2. `ak2` — write path + HITL gate  
3. `ak3` — read MCP/API  
4. `ak5` — boundary doc (can land early with Creatuuls M6d link)  
5. `ak4` — dogfood Spec + sync  
6. `ak6` — Desk Knowledge surface  

## Links

- Creatuuls seed pipeline (CLI stage → approve): creatuuls `docs/implementation-plan.md` §M6d  
- Thesis / HITL: [`relay_intent_spec_verify_hitl.plan.md`](./relay_intent_spec_verify_hitl.plan.md)  
- Open services (MCP as binding long-term): [`relay_open_services_platform.plan.md`](./relay_open_services_platform.plan.md)  
- Desk ASAP loop: [`relay_desk_closed_loop_asap.plan.md`](./relay_desk_closed_loop_asap.plan.md)  
