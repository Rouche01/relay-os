---
name: Open services platform
overview: "Long-term. Relay as a Spec + HITL OS for verticals (e.g. logistics/freight) where customers add the services they use; Desk infers binding (API, MCP, computer/browser) and scaffolds Specs without Relay pre-building every integration."
todos:
  - id: os0-thesis-lock
    content: "Lock thesis — Spec is law; Service = capability surface; Connection = secret/handle; Binding = API | MCP | browser | computer | human-only; customers extend catalog, Relay does not own every vertical API"
    status: pending
  - id: os1-service-model
    content: Formalize Service / Operation / Binding / Connection types + availability badges (live, mcp, computer, notify-only, blocked)
    status: pending
  - id: os2-desk-services-rail
    content: Desk Services navigation — catalog, add-from-words draft, import OpenAPI, import MCP tool list, attach connection, test call
    status: pending
  - id: os3-infer-binding
    content: "Scaffold/needs inference — if API/MCP unavailable, propose computer/browser or human.approve-only path instead of inventing fake api.request; detail in relay_capability_slots.plan.md"
    status: pending
  - id: os4-mcp-as-binding
    content: MCP as optional inbound binding behind descriptors (not a second runtime); document where MCP cannot replace shared act / Seats; outbound app MCP/API stays in knowledge plan (opt-in owner export)
    status: pending
  - id: os5-computer-path
    content: First-class computer/browser binding for UI-only vendors (CE Reddit lesson); shadow evidence still required before live
    status: pending
  - id: os6-vertical-pilot
    content: Pilot one non-consumer vertical (e.g. freight/TMS stub) — customer adds 1–2 services from words + HITL approval chain — after Services rail exists
    status: pending
isProject: true
---

# Open services platform (long-term)

Sibling of short-term [`relay_desk_closed_loop_asap.plan.md`](./relay_desk_closed_loop_asap.plan.md) (done), medium-term [`relay_capability_slots.plan.md`](./relay_capability_slots.plan.md) (scaffold slots + alternatives), and [`relay_app_knowledge_mcp.plan.md`](./relay_app_knowledge_mcp.plan.md). Design and product direction — **do not block** the ASAP closed loop.

## Why this exists

Relay’s value for companies (logistics, freight, ops teams) is not “we shipped every TMS/ERP connector.” It is:

1. **Intent → Spec** (auditable plan)
2. **HITL approval chains** (interrupt, Approve / Abort on Seats)
3. **Customers bring their services** — the tools they already use

If Relay must pre-author every service, the product is limited the same way Community Engager was limited by Reddit API / auth availability. CE’s fallback (redditapis / notify / browser thoughts) is the lesson: **bindings change; Specs and HITL should not.**

## Thesis (locked intent)

```text
Intent (plain English)
  → Spec (law: steps, rules, HITL)
  → Manifest (runtime)
  → Bindings resolve ops to: API | MCP | browser | computer | human

Service  = what can be done (ops + auth shape) — no secrets
Connection = granted handle/secret for a service ref
Binding  = how an op runs today (swappable)
```

Relay ships a **small curated seed** and **ways to grow the catalog**. Vertical packs (freight, community, triage) compose Specs; they do not own the only path to integrations.

## Lessons from Community Engager / Reddit

| Attempt | Outcome | Product rule |
|---------|---------|--------------|
| Official Reddit API | Unavailable / constrained | Fail closed; don’t pretend live write |
| Reddit auth app | Not available | Same |
| redditapis / notify-only | Worked as a binding | Prefer honest degraded binding over blocked product |
| Computer/browser | Human-like UI path when no API | First-class binding, not a hack |

Scaffold must **infer** which binding is possible from intent + installed services + connection state — not assume every noun has an `api.request`.

## Desk product shape (long-term)

| Rail | Job |
|------|-----|
| **Build** | Intent → Spec → Verify → Ship |
| **Apps** | Run once / schedule / pause |
| **Seats** | HITL interrupt |
| **Services** (new) | Catalog, add-from-words, import, connections, binding badges |

### Add service from words

1. Operator: “We use FreightOS / TMS X / email carrier updates.”
2. Desk proposes a **draft descriptor** + required ops + auth needs.
3. Operator picks binding: paste OpenAPI, connect MCP server, record computer recipe, or “human does this step.”
4. Test call / shadow before any App Enable.

Never auto-enable irreversible live writes without shadow evidence + connection.

## MCP’s place

Two directions — do not collapse them:

| Direction | This plan | Knowledge plan |
|-----------|-----------|----------------|
| **Inbound** | MCP as a **binding** — Relay calls external tools via imported ops | — |
| **Outbound** | — | Owner **opt-in** exposes selected app knowledge / side effects as MCP/API for other clients |

- **Yes (here):** import tools → operations; run as one binding behind the host.
- **No (here):** replace Spec-as-law, schedules, evidence, or shared desktop act/HITL.
- **Unavailable:** many UI-only or ToS-blocked surfaces → computer/browser or human-only.
- **Not this plan:** auto-publishing every Spec as a public service. Default app stays run-only; see [`relay_app_knowledge_mcp.plan.md`](./relay_app_knowledge_mcp.plan.md).

## Out of scope until Services rail exists

- Building a full freight product UI
- Pre-shipping dozens of logistics connectors
- Replacing ASAP closed-loop work
- App-as-service / knowledge export surface (owned by knowledge plan)

## Phasing (suggested)

1. Model + badges (docs + types)
2. Services rail MVP (list curated + connect + import OpenAPI)
3. Add-from-words → draft descriptor + needs
4. Infer API vs computer when API missing
5. MCP import as binding
6. Vertical pilot (freight or similar) with customer-added services + HITL chain

## Related

- [`relay_capability_slots.plan.md`](./relay_capability_slots.plan.md) — capability slots + ranked binding alternatives (scaffold contract)
- [`relay_app_knowledge_mcp.plan.md`](./relay_app_knowledge_mcp.plan.md) — outbound opt-in app MCP/API + knowledge store
- [`relay_desk_closed_loop_asap.plan.md`](./relay_desk_closed_loop_asap.plan.md) — short-term closed loop (complete)
- [`docs/manifesto-v2.md`](../../docs/manifesto-v2.md) — MCP vs acting
- [`ARCHITECTURE.md`](../../ARCHITECTURE.md) — API engine / MCP checkbox
- [`packages/protocol/src/service-descriptor.ts`](../../packages/protocol/src/service-descriptor.ts)
- [`packages/spec-scaffold/src/needs.ts`](../../packages/spec-scaffold/src/needs.ts)
- [`notify_only_redditapis_scout.plan.md`](./notify_only_redditapis_scout.plan.md)
