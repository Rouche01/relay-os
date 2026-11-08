---
name: Intent → slots + engine bridge
overview: "High-recall Intent→capability-slot detection (vocab + LLM propose, hedge toward include), always wire args.slot onto draft steps, and treat engines as the closed communication layer with ServiceDescriptors as per-vendor plugins. Completes the USP gap after capability-slots (cs0–cs6): detection visible in Design, bindings swappable on Ship, runtime always api.request|browser.*|computer.*|human.*|llm.*|data.*."
todos:
  - id: is0-thesis
    content: Lock thesis — engines closed; services are descriptor plugins; slots are Spec law; draft hedges high-recall on slots; binding resolve stays Ship; docs MCP authors descriptors not runtime
    status: completed
  - id: is1-design-slots-visible
    content: "FIRST — Design shows slots on the default GitHub ASAP path: attach args.slot (scm.issues) on scout/post; keep preferred github as draft hint; Spec-level slots strip for any sidecar; refresh Desk and confirm schematic badge + inspector"
    status: completed
  - id: is2-llm-slot-propose
    content: "LLM draft path — propose slots with confidence; include when confidence ≥ low threshold (high recall); never invent live APIs; unknown service → Needs[] or blocked candidate; operator drops via YAML / Re-Draft / Ship"
    status: pending
  - id: is3-engine-bridge-contract
    content: Document + harden per-engine bridge contract — Spec step.use is engine.verb only; service/op/connection only via args (+ slot resolve); one api.request path for all HTTP descriptors; same for browser/computer/human
    status: pending
  - id: is4-descriptor-from-docs
    content: "Descriptor authoring loop (open-services adjacent) — OpenAPI import (done) + optional Context7/docs-assisted draft descriptor → validate schema → catalog candidate; not on run hot path"
    status: pending
  - id: is5-guide
    content: GUIDE note on high-recall draft + confirm on Ship; engines closed / descriptors as plugins
    status: pending
  - id: is6-dogfood
    content: GitHub ASAP still passes closed-loop smoke with scm.issues args.slot + preferred github; YouTube/Reddit unchanged; one LLM-propose fixture with over-include then Re-Draft drop
    status: pending
isProject: true
---

# Intent → slots + engine bridge

Sibling of completed [`relay_capability_slots.plan.md`](./relay_capability_slots.plan.md), long-term [`relay_open_services_platform.plan.md`](./relay_open_services_platform.plan.md), and completed [`relay_desk_closed_loop_asap.plan.md`](./relay_desk_closed_loop_asap.plan.md) / [`relay_spec_to_working_app.plan.md`](./relay_spec_to_working_app.plan.md).

## Why this plan

Capability slots landed (types, Ship resolve, runtime `applyResolvedSlots`, YouTube/Reddit dogfood, Design badges when `args.slot` is set). Two gaps remain from product discussion:

1. **Detection under-attached** — Intent already maps to slots via vocab (`scm.issues` for GitHub), but ASAP GitHub steps still hardcode `service: github` with **no** `args.slot`, so Design/USP look like forever-github.
2. **Engine bridge not named as product** — Engines *are* the abstracted communication layer; descriptors are plugins. That story should be explicit so “add a service” never means “new runtime.”

## Thesis (lock in `is0`)

```text
Intent
  → high-recall capability slots (+ candidates)
  → Spec law: goal, rules, HITL, steps, slot ids
  → step.use ∈ engine catalog only (api | browser | computer | llm | data | human)
  → Ship resolves slot → descriptor/connection/binding
  → engine executes via one bridge per engine (e.g. api.request + ServiceDescriptor)
```

| Layer | Closed? | Role |
|-------|---------|------|
| **Engines** | Yes | How Relay acts (`api.request`, `computer.observe`, …) |
| **Service descriptors** | Growable | Vendor ops/auth/baseUrl — plugins into `api` (or MCP binding later) |
| **Connections** | Per install | Secrets — never in Spec |
| **Capability slots** | Spec law | What must be done; stable across binding swaps |
| **Candidates** | Refreshable | Ranked how; honest status (blocked/degraded/live) |

**Draft bias:** hedge toward **including** slots (high recall / low omit). Wrong slots are cheap to drop (YAML, Re-Draft, Ship). Missing slots are expensive. Never invent a **live** API status for an unknown service — use `blocked` / Needs / human / computer candidates instead.

**Docs / Context7:** author or refresh descriptors offline; **not** consulted on the run hot path.

## Non-negotiables

1. Spec `use` stays engine verbs only — no per-vendor `use: github.listIssues`.
2. ASAP closed-loop smoke still passes (GitHub triage) after `args.slot` attach; preferred candidate remains `github` / `github:default`.
3. Degraded / blocked never silent-default to looking live.
4. LLM may **propose** slots; it may not invent executable ops without a descriptor (or explicit computer/human candidate).
5. Open-services “add from words” rail stays long-term; this plan only bridges draft detection + engine contract clarity.

## In scope

### A. Intent → slots (high recall)

- Keep vocab seed as baseline (`matchCapabilityVocab`).
- Stub + LLM scaffold: for each matched (or LLM-proposed) slot, **attach `args.slot`** on the steps that exercise that capability (GitHub: scout + post → `scm.issues`).
- LLM propose: confidence threshold biased **low** (include if plausible); return slot id + needs + suggested binding kinds; merge with vocab; dedupe.
- Over-include OK; operator corrects at Spec / Re-Draft / Ship.

### B. Engine bridge (abstracted communication)

- One execution path per engine family:
  - **API / notify / mcp-as-HTTP:** `api.request` + ServiceDescriptor op
  - **Browser / computer / human / llm / data:** existing catalog verbs
- `applyResolvedSlots` remains the only place that rewrites service/connection/use from Ship resolution.
- Document the contract in GUIDE + short `docs/` or protocol comment so “new service” = new descriptor (+ optional vocab entry), not new engine.

### C. Descriptor growth (light)

- Point OpenAPI import (done) + optional docs-assisted draft at open-services; success = descriptor validates and can appear as a slot candidate.
- No full Services rail UI in this plan.

## Out of scope

- Replacing ASAP success criteria
- Full MCP inbound binding marketplace
- Freight vertical product
- Auto-resolving degraded without operator click
- Runtime calls to Context7

## Suggested sequencing

1. ~~`is0` thesis lock~~ (2026-11-07)  
2. ~~`is1` Design slots visible~~ — GitHub scout/post use `args.slot: scm.issues`; ASAP pre-resolves preferred github; Design step badges + **Capability slots** strip  
3. `is3` engine-bridge contract note (can parallel)  
4. `is2` LLM propose with confidence / high-recall merge  
5. `is5` GUIDE  
6. `is4` docs→descriptor loop (thin)  
7. `is6` dogfood / smoke  

### `is0`–`is1` done (2026-11-07)

- Thesis locked in this plan.  
- Stub GitHub triage attaches `scm.issues`; Design shows node badges + canvas strip.  
- New Spec (GitHub triage) → Design to verify; refresh Desk if needed.  


## Success criteria

1. GitHub triage draft shows `slot · scm.issues` on Design; Ship can pick `api/github` vs `human` without rewriting goal/step ids.  
2. Closed-loop smoke still green with preferred github binding resolved (or auto-preferred + explicit resolve in Ship before run — fail closed if `args.slot` unresolved).  
3. LLM draft on a multi-domain intent emits ≥1 extra plausible slot when vocab alone would miss, without inventing live unknown APIs.  
4. GUIDE states: engines closed; services = descriptors; draft high-recall; Ship confirms binding.  

## Links

- Capability slots (done): [`relay_capability_slots.plan.md`](./relay_capability_slots.plan.md)  
- Open services: [`relay_open_services_platform.plan.md`](./relay_open_services_platform.plan.md)  
- Desk GUIDE: [`apps/relay-desk/GUIDE.md`](../../apps/relay-desk/GUIDE.md)  
- Vocab + apply: [`packages/protocol/src/capability-slots.ts`](../../packages/protocol/src/capability-slots.ts), [`apply-resolved-slots.ts`](../../packages/protocol/src/apply-resolved-slots.ts)  
- Scaffold slots: [`packages/spec-scaffold/src/slots.ts`](../../packages/spec-scaffold/src/slots.ts)  
- Design canvas polish (xyflow layout / binding-on-node): [`desk_design_schematic_canvas.plan.md`](./desk_design_schematic_canvas.plan.md) — separate from `is2`+; Spec stays truth  

