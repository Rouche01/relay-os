---
name: Desk closed loop ASAP
overview: "COMPLETE (2026-11-07). Short-term. Prove Relay Desk as a usable product with the few services already in catalog — plain intent → Spec → Ship → Apps Run once / schedule → Seats HITL — without inventing a general service marketplace yet. Next medium-term for brittle service pick: relay_capability_slots.plan.md."
todos:
  - id: cl1-pick-path
    content: Lock dogfood path — GitHub triage (preferred live) and/or curated fashion/CE read path (fixtures OK); refuse Reddit write as ASAP success criteria
    status: completed
  - id: cl2-scaffold-constrain
    content: Constrain Desk scaffold to catalog ops + known connections; surface needs[] clearly when intent asks for missing services
    status: completed
  - id: cl3-run-once-hitl
    content: Fix Run once → fanout HITL pauses parent and lands on Seats (no approve→unknown continue)
    status: completed
  - id: cl4-connections-ux
    content: Thin Connections (or Settings) UX — mark/test required connections for installed apps; document env/keychain for live tokens
    status: completed
  - id: cl5-smoke-script
    content: One smoke path — New spec → Verify → Ship gate → Apps Run once → Seats Approve/Abort → run completes; Enable schedule optional second check
    status: completed
  - id: cl6-guide
    content: GUIDE.md — ASAP loop only; honest limits (fixtures vs live, which services work)
    status: completed
isProject: true
---

# Desk — closed loop ASAP (short-term)

**Status: complete** — all `cl1`–`cl6` todos done; smoke + GUIDE in place.

Sibling of long-term [`relay_open_services_platform.plan.md`](./relay_open_services_platform.plan.md) and medium-term [`relay_capability_slots.plan.md`](./relay_capability_slots.plan.md). Does **not** invent customer-authored services, MCP marketplace, or logistics domain packs.

**Goal:** One trustworthy loop operators can feel: *say what you want → prove it → run it → interrupt when needed.*

## In scope

| Step | Done means |
|------|------------|
| Intent | New Spec from plain English against **existing** curated services |
| Spec | Validate / soft rules / freeze |
| Ship | Install → connect → shadow → approve evidence |
| Operate | Apps **Run once** and/or **Enable** schedule |
| HITL | Waiting runs open **Seats** → Approve / Abort → resume |

## Out of scope (long-term plan)

- Customer “add any service from words”
- Infer API vs computer vs MCP binding automatically
- Reddit write / auth-app productization
- Freight/logistics vertical
- My Desk

## Locked choices

1. **Success services:** prefer GitHub (or another catalog service with real tokens). Reddit write is not the ASAP bar; fixtures/read-only OK for demo only if labeled as such.
2. **No new service authoring UI** — only connect + run what exists.
3. **Fanout HITL must pause** — Run once that skips Seats is a bug for this plan.
4. **Build YAML live run stays forbidden** — live from Apps after shadow gate.

## Locked dogfood path (2026-11-02) — `cl1`

| | |
|--|--|
| **Primary ASAP Spec** | **GitHub bug triage** — intent in [`apps/triage-gen/intent.md`](../../apps/triage-gen/intent.md), bar in [`SUCCESS.md`](../../apps/triage-gen/SUCCESS.md), shape in [`spec.expected.yaml`](../../apps/triage-gen/spec.expected.yaml) |
| **Service / connection** | Curated `github` + `github:default` |
| **Desk entry** | New Spec default preset **GitHub triage** (`DEFAULT_GITHUB_TRIAGE_INTENT`) |
| **Live success** | Shadow → approve → Run once / Enable with real token when available; fixture issues OK for offline |
| **Not ASAP success** | Reddit write / CE fashion comment posting (preset kept as **CE fashion (demo)** only) |
| **Not ASAP** | Freight wedge preset labeled **(later)** — long-term platform |

### `cl2` done (2026-11-02)

- Offline `stubSpecFromIntent` is intent-aware: **GitHub triage** | CE reddit demo | generic HITL-only (no invented API).
- LLM scaffold prompt example is GitHub triage; still fail-closed on unknown ops.
- Preflight `needs[]` for missing catalog services; New Spec rail lists curated services.
- Tests: `server/stub-spec.test.ts`.

### `cl3` done (2026-11-02)

- Fanout child `WAITING_USER` under `pauseOnHitl` bubbles to parent (no more `approve → unknown` → post).
- Resume continues the fanout after Seats Approve (may pause again on the next item).
- Test: `spec-host` HITL `forEach human.approve` pause + resume.
- Rebuild `@relay/runtime` (and restart Spec API) before dogfood.

### `cl4` done (2026-11-02)

- Apps / Ship: **mark ready** wording (not “connected = has token”).
- Settings: Live connections docs + **Probe connections** (`GET /api/v2/connections`).
- App runs: env/file secrets preferred via composite store, memory stub fallback.
- `.env.example` + GUIDE Connections section.

### `cl5` done (2026-11-07)

- Automated: `apps/relay-shell/server/closed-loop-smoke.test.ts` (stub → install → mark → shadow → approve → Run once → resume → Enable).
- Manual: [`apps/relay-desk/SMOKE.md`](../../apps/relay-desk/SMOKE.md).
- Fixes for the loop: resume honors checkpoint `dryRun` (live Run once); stub LLM returns `issue_number` for GitHub; resume preserves re-keyed `specHash` so completed runs stay under Apps.

### `cl6` done (2026-11-07)

- GUIDE: **What works today (ASAP)** table — fixtures + blocked network vs mark-ready vs live secrets; smoke links; not Reddit write / open services.

## Verify

- [x] Intent using only catalog services scaffolds without fake ops
- [x] Ship checklist completes
- [x] Run once appears under app runs (correct specHash)
- [x] HITL appears on Seats and resume finishes the run
- [x] Enable schedule still separate from Run once
- [x] GUIDE matches what actually works

## Related

- [`apps/relay-desk/GUIDE.md`](../../apps/relay-desk/GUIDE.md)
- [`relay_capability_slots.plan.md`](./relay_capability_slots.plan.md) — next for service/binding choice
- [`relay_open_services_platform.plan.md`](./relay_open_services_platform.plan.md)
- [`relay_capability_slots.plan.md`](./relay_capability_slots.plan.md) — slots dogfood (YouTube/Reddit); does not change ASAP GitHub bar
- [`relay_spec_to_working_app.plan.md`](./relay_spec_to_working_app.plan.md)
- [`desk_spec_workspace_ux.plan.md`](./desk_spec_workspace_ux.plan.md)
