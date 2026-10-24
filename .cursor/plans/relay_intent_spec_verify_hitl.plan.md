---
name: Relay intent→spec→verify→HITL readiness
overview: "Make Relay’s thesis demoable: Intent→frozen Spec→prove→HITL, with Spec as the addressable surface for computer work. Protocol engine is the preferred path (Spec-native capabilities); browser/computer-use is the compatibility fallback for GUI-only systems. Dogfood on CommunityEngager first; formal vericoding stays in research-lab."
todos:
  - id: spec-schema
    content: "Define Spec schema in @relay/protocol — goal, constraints, allowed_actions, acceptance[], hitl_required[], budget; optional action_binding (protocol | browser); status draft→frozen→running→satisfied|aborted; freeze = explicit human (or documented auto) gate"
    status: completed
  - id: intent-type
    content: "Define Intent type + persistence — natural-language goal + structured slots; link Intent → Spec; store via action-store (or Spec store) for replay/demo"
    status: completed
  - id: engage-compiler-v1
    content: "CommunityEngager Intent→Spec compiler v1 — template fill only (no free-form stage invention); map slots to Spec + bind existing engage/post_watch manifests (browser path dogfood)"
    status: completed
  - id: runtime-bound-to-spec
    content: "Runtime/app refuse work outside frozen Spec — capabilities, budgets, dry-run default, allowlist/policy; thaw required to widen constraints"
    status: completed
  - id: evidence-pack
    content: "Evidence pack before execute — acceptance checks as artifacts (score gate, constraint checklist, dry-run log, allowlist membership); fail closed if incomplete"
    status: completed
  - id: hitl-bound-to-spec
    content: "HITL bound to Spec — optional Approve Spec before run; Approve/Edit/Abort draft; Spec-affecting edits thaw→re-freeze; Telegram/CLI remain primary adapters"
    status: completed
  - id: thin-shell-or-demo-path
    content: "Thin demo surface — living-todo card OR documented CLI/Telegram script showing Intent→Spec→Evidence→HITL→act; full living-todo UX can stay on shell plan"
    status: pending
  - id: e2e-thesis-demo
    content: "E2E cold demo — create intent → show Spec → freeze → run → WAITING_YOU with evidence → edit/approve/abort → dry-run or post; record checklist + short script"
    status: pending
  - id: protocol-engine-sketch
    content: "Sketch Spec-native protocol engine — declare/invoke/observe/evidence against same Spec types; no full adoption push yet; one stub or doc that shows protocol path vs browser path under one Spec"
    status: pending
  - id: research-lab-link
    content: "Cross-link research-lab/spec-owned-vericoding — product Spec = near-term human-owned surface; formal vericoding deferred; steal patterns both ways, no merge"
    status: pending
  - id: readme-plans-index
    content: "Index this plan from README Plans + note dependency on HITL community plan / living-todo shell plan"
    status: completed
isProject: true
---

# Relay — intent → frozen Spec → verify → HITL

Canonical plan for making the **product thesis** real and demoable. Open while the `relay-os` workspace is active.

**Thesis:** Agents that compile intent into a frozen spec, run against it, prove acceptance, and negotiate with you before they act.

## Architecture clarity (2026-10-24)

**Spec is how agents address computer work.** Engines differ; authority does not.

| Path | Role | When |
|------|------|------|
| **Protocol (preferred)** | Spec-native declare → invoke → observe → evidence | System exposes Spec-shaped capabilities (APIs, agent-native surfaces) |
| **Browser / computer-use (fallback)** | Same Spec; drive GUI/DOM as compatibility | Legacy or closed apps that only speak human UI |

Implications:

- Agents **do not always need a GUI** to do computer-based tasks — they need a **Spec-addressable** way to act.
- Human GUIs for *doing* the work shrink; **governance UIs** (freeze Spec, HITL, evidence) remain.
- Long horizon: Spec-derived **intent-native apps** (happy path may have no task GUI). That is north star, not the first demo.
- CommunityEngager remains the dogfood vertical on the **browser** path; protocol path is sketched so Spec schema doesn’t paint us into “GUI-only agents.”

## Goals

### Primary (ready bar)

Ship **one vertical** (CommunityEngager) where a cold demo visibly does the thesis:

1. State an **Intent**
2. Compile → durable **Spec** (inspectable)
3. **Freeze** Spec (human-owned authority)
4. **Run** stages bound to that Spec (browser engine for this vertical)
5. **Prove acceptance** with an evidence pack (not “model said done”)
6. **Negotiate** (Approve / Edit / Abort) before irreversible action
7. Act or abort; outcomes learnable via VoltMem as today

### Secondary (same plan, not blocking demo)

8. Spec schema + docs make **protocol vs browser** binding explicit
9. **`protocol-engine-sketch`** — stub or design note: same Spec, protocol engine path (no requirement to migrate Reddit off browser yet)

### Non-goals (this plan)

- Full browser OS / Intent Router app registry / multi-app composition
- Free-form self-orchestration that invents stage graphs
- Porting Dafny / formal vericoding into Relay runtime
- Second vertical before engage proves the loop
- Replacing Telegram/CLI HITL with a polished product UI (thin demo surface is enough)
- Replacing all browser automation with protocol before Spec loop works
- Declaring “GUIs are dead” as a product claim (governance surfaces stay)

### Research boundary

| Track | Repo | Owns |
|-------|------|------|
| Product trust | `relay-os` (this plan) | Spec schema, compile, evidence, HITL binding, dual engine framing |
| Formal vericoding | `~/Projects/research-lab/spec-owned-vericoding` | Mid-IR, proofs, Dafny loops, Aver/Djinnlang map |

Near-term trust split (aligned with the lab README): **human-owned surface = Intent + frozen Spec + HITL**; bodies (manifests, drafts, protocol adapters, DOM glue) are regenerable; proof = **gates + evidence + HITL**. Formal verification is a later hardening layer for high-stakes stages.

## Depends on

- [`relay_hitl_community_voltmem.plan.md`](./relay_hitl_community_voltmem.plan.md) — protocol, runtime, Feedback Broker, CommunityEngager, Telegram, VoltMem (**mostly done**)
- [`relay_living_todo_shell.plan.md`](./relay_living_todo_shell.plan.md) — optional UX shell; this plan only needs a **thin** card or CLI/Telegram demo path. Prefer not to block thesis E2E on full living-todo UI.

## Target loop

```text
Intent ──compile──► Spec (draft)
                      │
                   freeze (HITL or explicit accept)
                      ▼
                 Spec (frozen)
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
   protocol engine          browser engine
   (preferred when          (fallback when
    Spec-addressable)        GUI-only)
          │                       │
          └───────────┬───────────┘
                      ▼
                 Evidence pack ◄── acceptance checks
                      │
                   incomplete? ── fail closed
                      │
                   complete ──► WAITING_YOU (negotiate)
                      │
              approve / edit / abort
                      │
         irreversible act only after approve
```

## Steps (work order)

### Phase A — Spec as a first-class object

1. **`spec-schema`** — Add Spec types to `@relay/protocol` (or a small `packages/spec` if protocol stays event-focused). Required fields:
   - `goal`, `constraints[]`, `allowed_actions[]`, `acceptance[]`, `hitl_required[]`, `budget`
   - `action_binding` (or per-action): `protocol` | `browser` (extensible)
   - `status`: `draft` | `frozen` | `running` | `satisfied` | `aborted`
   - Freeze is explicit; widening constraints requires thaw
2. **`intent-type`** — Intent record + link to Spec; persist enough for replay and demos
3. **`readme-plans-index`** — Link this plan from root README (can land early)

### Phase B — Bind CommunityEngager (compiler v1, browser dogfood)

4. **`engage-compiler-v1`** — Template-fill Intent → Spec → existing engage / post_watch manifests. No LLM inventing stages yet.
5. **`runtime-bound-to-spec`** — Enforce Spec budgets/capabilities/policy; refuse out-of-spec work

### Phase C — Prove + negotiate

6. **`evidence-pack`** — Structured checks before `execute` (score, constraints, dry-run, allowlist, etc.); fail closed
7. **`hitl-bound-to-spec`** — Optional Approve Spec; draft HITL; Spec-affecting edit thaws

### Phase D — Demo + dual-path sketch + research sync

8. **`thin-shell-or-demo-path`** — Smallest surface that shows the artifacts (Intent, Spec, Evidence, HITL card)
9. **`e2e-thesis-demo`** — Documented cold script + checklist; optional short recording
10. **`protocol-engine-sketch`** — Design note + minimal stub: Spec-native invoke/observe under same types; prove we aren’t Spec-for-DOM-only
11. **`research-lab-link`** — Update lab Related thread: Relay frozen Spec = near-term human-owned surface

## Acceptance criteria (plan done)

- [ ] Spec schema exists and is used by CommunityEngager engage path
- [ ] Spec schema allows distinguishing protocol vs browser action binding
- [ ] At least one Intent template compiles to a frozen Spec bound to the engage manifest
- [ ] Execute is blocked without a complete evidence pack when Spec requires it
- [ ] HITL can approve Spec and/or draft; abort prevents write; edit that changes constraints re-opens Spec
- [ ] Cold demo script in-repo (README section or `deploy/` / app README) walks Intent → Spec → Evidence → HITL → act
- [ ] Protocol engine sketch exists (doc ± stub) showing same Spec, non-GUI path
- [ ] research-lab thread points at this product meaning of Spec; no formal verifier required in Relay

## Tracking

Use the YAML `todos` above as the source of truth for status (`pending` / `in_progress` / `completed`). Append dated notes under **Log** below when a todo lands or scope shifts — do not rewrite history in the log.

### Suggested build slice order

| Priority | Todo ids | Why |
|----------|----------|-----|
| P0 | `spec-schema`, `intent-type` | Unblocks everything; include action_binding in schema |
| P0 | `engage-compiler-v1`, `evidence-pack` | Thesis becomes visible on dogfood app (browser) |
| P1 | `runtime-bound-to-spec`, `hitl-bound-to-spec` | Trust split is real |
| P1 | `thin-shell-or-demo-path`, `e2e-thesis-demo` | Ready for storytelling / YC-style demo |
| P2 | `protocol-engine-sketch` | Lock dual-path architecture without delaying engage demo |
| P2 | `research-lab-link`, `readme-plans-index` | Keep docs/research aligned |

## Out of scope reminders

- Self-orchestrating stage invention = **after** template Spec loop works
- Living todo polish = [`relay_living_todo_shell.plan.md`](./relay_living_todo_shell.plan.md)
- Formal proofs / mid-IR = research-lab only until a high-stakes stage needs it
- Full Spec-native protocol adoption across third-party apps = later plan
- Intent-native application format deduced from Spec = north star, not this plan’s exit criteria

## Log

### 2026-10-22

- Opened plan from thesis refresh: Intent → frozen Spec → prove acceptance → negotiate before act.
- Readiness path agreed: CommunityEngager-only; compiler v1 = template fill; product proof = evidence + HITL; formal vericoding stays in research-lab.
- Indexed from root README Plans; `readme-plans-index` marked completed.

### 2026-10-24

- Clarified architecture: **Spec protocol preferred** for computer work; **browser/computer-use is compatibility fallback** for GUI-only systems. Same Spec binds both.
- Plan change: additive — P0 dogfood path unchanged (CommunityEngager/browser); added `protocol-engine-sketch`, `action_binding` on Spec schema, dual-path diagram, secondary goals. Did not reopen OS / “GUIs are dead” scope.
- Wrote [`docs/viability.md`](../../docs/viability.md) — viability by layer, risks, path, YC pitch shape; linked from README.
- Implemented `@relay/protocol` Spec + Intent (`spec.ts`, `intent.ts`): freeze/thaw/running/satisfied/aborted helpers; procedure binding; typed acceptance; action_binding. Persistence (action-store) deferred to engage-compiler / later. Docs: [`docs/spec.md`](../../docs/spec.md). Marked `spec-schema` + `intent-type` completed.
- CommunityEngager `compileEngageFromSlots` / `compileEngageIntent` — template Intent→draft Spec for engage|post_watch; tests in `test/engage-compiler.test.ts`. Marked `engage-compiler-v1` completed. Next: `evidence-pack` / `runtime-bound-to-spec`.
- Evidence pack: `@relay/protocol` `evaluateSpecEvidence`; CommunityEngager `assertEngagePreExecuteEvidence` gates `runExecute` when `ctx.spec` set; `options.spec` propagated to fanout children. Tests in `test/evidence-pack.test.ts`. Marked `evidence-pack` completed. Next: `runtime-bound-to-spec`.
- Runtime bind: `bindingsFromSpec` / `resolveMaxJobs` / `activateSpecForRun` — Spec enforces maxJobs, dryRun, forceDiscover, no_promo on draft+execute; fanout uses Spec maxJobs. Marked `runtime-bound-to-spec` completed. Next: `hitl-bound-to-spec`.
- Spec HITL: `negotiateSpecBeforeRun` before stages (Approve/Edit/Abort); Edit recompiles+freezes; Abort returns empty ABORTED summary. Default on when spec+adapter; `--skip-spec-hitl` to skip. Marked `hitl-bound-to-spec` completed. Next: `e2e-thesis-demo` / thin demo path.
