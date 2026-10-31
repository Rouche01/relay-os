---
name: Desk Spec/App workspace UX
overview: "Implement the Flowstep workspace design (2026-10-31) under the locked rail Seats · Build · Apps: replace the scrolling Spec surface with a Build library + New-spec screen + Design/Verify/Ship/Activity workspace; Apps is the approved-fleet home (not a second authoring door). Desk-only against existing /api/v2/*. My Desk is out of scope — see desk_my_desk.plan.md."
todos:
  - id: w0-design-lock
    content: Lock design/copy mapping — Flowstep Workspace + Specs screens → styles.css tokens (--signal #3EE0C4 etc from DESIGN.md, not Flowstep grayscale); copy rules from DESIGN.md § Copy; rail labels Seats · Build · Apps (Settings footer); do not render My Desk
    status: completed
  - id: w1-workspace-routing
    content: Workspace shell + routing — hash routes synced with mainTab seats|build|apps (deep-linkable per D1); WorkspaceHeader + journey bar + stage nav; Seats bento unchanged; no My Desk tab
    status: completed
  - id: w2-library
    content: Build library — Build nav lands here; in-progress only (local draft store from upgraded spec/history.ts — drafts + frozen-not-installed); do not merge GET /api/v2/apps into this list; per-row state phrase + specific action; New spec CTA; Paste-YAML as a secondary door (Install-bundle lives on Apps)
    status: completed
  - id: w3-new-spec
    content: New-spec screen — extract Intent presets (CE fashion/Freight wedge/Blank from INTENT_PRESETS), intent field with hard-limits guidance, Create draft (scaffoldSpec) with outcome states llm|stub|needs_edits|needs (ScaffoldNeed rendering reused); success creates a draft record and routes to workspace Design; needs path names import-descriptor/add-connection
    status: pending
  - id: w4-journey-state
    content: Journey/lifecycle derivation — replace scroll-anchor stepper (scrollToSpecStep) with derived state: lifecycle (draft|checks passed|frozen|live|paused|needs catalog) from pipeline state (deriveSpecPipeline/gateSpecAction) for drafts and InstalledAppSummary for apps; journey = 4 views only, gates stay inside views
    status: pending
  - id: w5-schematic-model
    content: Schematic model — pure deriveSchematic(body|manifest, run?) in spec/schematic.ts: trigger node, ordered step nodes (use→plain verb, service, forEach stack, once/when/retry badges, irreversible flag via manifest/descriptor data already in responses), HITL diamond for human.*, rules strip (enforce map), edge refs; run overlay states (done/waiting/simulated/skipped) from RunResponse stepOutputs+evidence
    status: pending
  - id: w6-design-view
    content: Design view — intent strip (Re-draft), schematic canvas (Schematic|Manifest|YAML toggle), node click → inspector (args/forEach/once/outputs/schema/enforce, from schematic model) + YAML drawer with existing findYamlIssueLine/focusYamlLine jump; YAML edit stays source of truth
    status: pending
  - id: w7-verify-view
    content: Verify view — All-checks summary in plain language, irreversible-step risk callout (derived, names the step), Structure + Rules-from-intent tables (reuse validation/evals rendering from SpecSurface), What-it-compiles-to strip from LowerResponse manifest stages; failures jump to YAML line in Design
    status: pending
  - id: w8-ship-view
    content: Ship view — Going-live checklist unifying the two existing backends behind one adapter (draft YAML: freeze/export-bundle/schedule-enable + run shadow via /api/v2/*; installed app: connect/shadow-run/approve-evidence/enable/pause via /api/v2/apps/:id/*); evidence ∥ simulated writes review; Enable locked until shadow evidence approved (needsShadowGate); successful enable lands the app on Apps
    status: pending
  - id: w9-activity-view
    content: Activity view — runs list (draft: GET /api/v2/runs by specHash; app: GET /api/v2/apps/:id/runs) with plain-language run summaries, run detail as schematic overlay (w5), evidence + outcome follow-ups (processOutcomes), paused-at-HITL row deep-links to Seats (rename onOpenConsole), Pause; Edit spec (thaw) is a door back to Build Design and re-gates
    status: pending
  - id: w10-apps-rework
    content: Apps = approved fleet only — installed list + install-bundle paste (existing client.ts); enable/pause/connect/schedules/runs stay here as management; selecting an app does not open Build Design/Verify; Edit spec / thaw is the only door back to Build; remove lifecycle tiles that duplicate w8/w9 authoring
    status: pending
  - id: w11-state-styles
    content: State + styles pass — draft/workspace state survives navigation and reload (persist draft store + selected entity/view; SpecSurface local state lifted into a workspace store/hook), styles.css workspace classes on existing tokens, collapsed-sidebar + narrow-window behaviour, no Seats/HITL regressions (Console behaviour, new name)
    status: pending
  - id: w12-verify-docs
    content: Verify + docs — desk typecheck/build, shell tests untouched (installed-apps.test.ts), manual E2E checklist (triage draft → checks → freeze → shadow → approve → enable → appears on Apps → run pauses at HITL → Seats); update DESIGN.md Flowstep list to implemented + plan log in relay_spec_to_working_app (p2/e2e linkage)
    status: pending
isProject: true
---

# Desk — Spec/App workspace UX (implementation)

Prototype: Flowstep [Relay Desk](https://app.flowstep.ai/file?activeFileId=a7a26c2d-f42b-4309-955c-7f931d81c6fe) screens `Specs — library`, `Specs — new`, `Workspace — Design/Verify/Ship/Activity` (2026-10-31). Design system + copy rules: [`apps/relay-desk/DESIGN.md`](../../apps/relay-desk/DESIGN.md) (incl. § Copy). Follow-on to [`desk_spec_surface_ux.plan.md`](./desk_spec_surface_ux.plan.md) (single-surface operability, done) and `p2-desk-app-lifecycle` in [`relay_spec_to_working_app.plan.md`](./relay_spec_to_working_app.plan.md) (Apps lifecycle backend, done). Personal computer surface is a separate backlog: [`desk_my_desk.plan.md`](./desk_my_desk.plan.md).

## Problem

`Intent → Outcome` is four jobs at four timescales (design minutes, verify minutes, ship once, operate weeks) but Desk renders it as one scrolling tile stack (`SpecSurface.tsx`, ~1,650 lines: Intent, YAML, Validator, Evals, Manifest, Freeze, Dry-run) plus a second, duplicated lifecycle in `AppsSurface.tsx` (connect/shadow/approve/enable/runs as tiles). The Flowstep journey already crosses views — incoherently. There is also no entry point: no library of Specs and no creation screen; creation is buried inside the Spec surface.

## Target IA

Rail (locked 2026-10-31): **Seats · Build · Apps**. Settings stays in the rail footer. **My Desk** is a reserved fourth item — do not render it in this plan.

| Rail | Owns | Does not own |
|---|---|---|
| **Seats** | Today's Console: gateway / watch / seat inventory / HITL. Badge pool + pending HITL. You *attend* pooled computers any app can spin up. | Authoring, fleet management, the user's personal computer |
| **Build** | Intent → Spec → Manifest → App. Library of *in-progress* work, New spec, workspace Design / Verify / Ship (and Activity while first-shipping). | Approved/live fleet, seat lease chrome |
| **Apps** | Approved, installed apps as a managed fleet: connect, enable/pause, schedules, runs, outcomes. Install-bundle door. | Drafts, scaffold, Design/Verify authoring |
| **My Desk** | Out of scope here. Dedicated personal computer — see [`desk_my_desk.plan.md`](./desk_my_desk.plan.md). | — |

Cross-links: Build Ship enable → row appears on Apps. Apps *Edit spec* / thaw → Build Design (re-gates). Activity HITL → Seats. Apps runs that pause badge Seats. Never invent My Desk as “another seat.”

```text
Rail: Seats · Build · Apps · (Settings footer)
                   My Desk reserved, not rendered

Build nav → library (drafts / frozen-not-installed)
              └── New spec ──► draft ──► Workspace Design
              └── row click ────────────► Workspace (Design / Verify / Ship / Activity)

Apps nav  → installed / approved list
              └── manage (enable / pause / connect / runs)
              └── Edit spec ──► Build Design (thaw, re-gate)

Activity HITL ──► Seats
```

## Current-state map (what moves where)

| Today | Destination | Notes |
|---|---|---|
| `SpecSurface` Intent tile + presets + scaffold | **New-spec screen** (w3) | `INTENT_PRESETS`, `scaffoldSpec`, `ScaffoldNeed` UI reused |
| YAML tile + `findYamlIssueLine`/`focusYamlLine` | **Design** YAML drawer (w6) | YAML stays source of truth |
| Validator + Rules/evals tiles | **Verify** (w7) | re-rendered plain-language; codes stay in mono details |
| Manifest tile (`LowerResponse`) | Verify “what it compiles to” + Design Manifest toggle | |
| Freeze + Dry-run tiles (incl. shadow mode, evidence approval, schedule enable, outcomes) | **Ship** (w8) + **Activity** (w9) | dry-run run detail is Activity, not Ship |
| Pipeline stepper (`deriveSpecPipeline`, `scrollToSpecStep`) | Journey bar (w4) | scroll anchors deleted; gates stay via `gateSpecAction` |
| `AppsSurface` Lifecycle tile (`/api/v2/apps/:id/*`) | **Apps** management (w10); first-ship checklist stays Build Ship (w8) | do not open Design/Verify from an Apps row |
| `AppsSurface` Install + Installed tiles | **Apps nav** (w10) | install door stays on Apps; create stays on Build |
| localStorage scaffold history (`spec/history.ts`, max 8) | **Build library** draft source (w2) | upgraded, see D2; installed apps stay on Apps |
| Console HITL cards | **Seats** (rename) | Activity deep-links (`onOpenConsole` → Seats) |

## API inventory (no new backend required for v1)

Already available: `/api/v2/scaffold|validate|lower|evals|freeze|run`, `/api/v2/runs[/:id[/approve-evidence|resume|replay]]`, `/api/v2/schedule/enable`, `/api/v2/outcomes/process`, `/api/v2/bundle/export|import`, `/api/v2/apps[/:id[/connect|shadow-run|approve-evidence|enable|pause|resume|disable|runs|thaw|refreeze]]`. Desk clients: `spec/client.ts`, `apps/client.ts` — extend, don't parallel-write.

## Decisions (resolve in w0/w1, in order)

- **D1 Routing.** Recommendation: hash routes synced with `mainTab` (`seats` \| `build` \| `apps`) — `#/seats`, `#/build`, `#/build/new`, `#/build/:draftId/:view`, `#/apps`, `#/apps/:id`. Deep links were a design requirement; no router dep. Fallback: pure state if hash fights Tauri WebView history (spike first in w1). Do not add `#/desk` in this plan.
- **D2 Library source of truth.** Installed apps are server-persisted (`.data/installed-apps/`) and belong on **Apps**, not Build. Draft/frozen Specs are **not** server-persisted — `handleFreeze` returns a frozen Spec but stores nothing, and Desk drafts live only in component state + 8-entry localStorage history. Recommendation v1: Desk-local draft store (localStorage, keyed by draft id, goal/intent/yaml/status/updatedAt) is the Build library; `GET /api/v2/apps` feeds Apps only. Document “drafts live on this Desk” in the Build footer. Server draft persistence (`GET/POST /api/v2/drafts` on `@relay/spec-store`) is a follow-on — do not block the UX on it.
- **D3 Ship's two backends.** Authoring Ship acts on YAML (`freeze`, `bundle/export`, `schedule/enable`, `run` shadow); installed Ship acts on an app id (`apps/:id/*`). One Ship view, two adapters selected by entity kind (`ship/draft-adapter.ts`, `ship/app-adapter.ts`) exposing the same checklist steps: frozen → connected → shadow approved → enabled. Never call both for one entity; installing a bundle is the bridge (export → install → app adapter).
- **D4 Schematic data.** Desk has no YAML parser dep and imports no `@relay/*` packages (HTTP only). Scaffold/validate responses already carry a parsed `body`. Recommendation: keep `body` in workspace state next to the YAML (refresh via `validateSpec` after manual YAML edits) and derive the schematic from `body` + lowered manifest; only add the `yaml` dep to Desk if body coverage proves incomplete. Schematic derivation is a pure function (w5) so it is testable without rendering.
- **D5 State ownership.** Lift `SpecSurface`'s ~25 `useState`s into a workspace store (`spec/workspace-store.ts`, Preact state/signals-free — plain hooks) so views share one draft, one validation/evals/lowered/run cache, and navigation doesn't lose a 90-second scaffold. `SpecSurface.tsx` is then deleted in slices, not rewritten big-bang: each view lands behind the workspace route while the old surface stays reachable until w9.

## Build order (each slice shippable, old surface intact until w9)

1. **w0–w1** shell: rename rail + workspace route + header/journey/nav with placeholder views; old Spec/Apps still default behind `build`/`apps`.
2. **w2–w3** entry: Build library + new-spec create drafts into the draft store; rows open the *old* surface pre-filled at first, workspace Design once w6 lands.
3. **w4–w7** authoring: journey derivation, schematic model + Design, Verify. Cut Build nav over to workspace here.
4. **w8–w9** shipping: Ship adapters, Activity; enable lands on Apps; HITL → Seats; delete duplicated authoring tiles (w10) and finally `SpecSurface.tsx`.
5. **w11–w12** persistence/style hardening, verification, docs.

## Expected files

- New: `apps/relay-desk/src/workspace/{Workspace.tsx,header.tsx,journey.ts,routes.ts}`, `src/specs/{SpecsLibrary.tsx,NewSpec.tsx,library.ts,draft-store.ts}`, `src/spec/schematic.ts`, `src/workspace/views/{DesignView,VerifyView,ShipView,ActivityView}.tsx`, `src/workspace/ship/{draft-adapter,app-adapter}.ts`
- Modified: `src/app.tsx` (routing), `src/spec/{client,types,pipeline}.ts` (body retention, journey derivation), `src/apps/{AppsSurface,client}.ts`, `src/styles.css`
- Deleted at cutover: `src/spec/SpecSurface.tsx`, `scrollToSpecStep` + stepper rendering

## Acceptance criteria

- [ ] Rail reads Seats · Build · Apps (no My Desk item); Settings remains footer
- [ ] From Desk launch: Build library → New spec (preset or blank) → Create draft → lands in Design with a correct schematic for the triage Spec (trigger, scout, forEach stack, HITL diamond, irreversible post, rules strip) without touching YAML
- [ ] Build library lists drafts/frozen-not-installed only; approved apps appear on Apps after enable, not as Build rows
- [ ] Every label follows DESIGN.md § Copy: one stage vocabulary, lifecycle only in header pill, user-facing verbs (*Create draft*, *run checks*, *Edit spec*); internal nouns only in mono details
- [ ] Verify names the irreversible step and its protections in plain language; a validator failure jumps to the exact YAML line in Design
- [ ] Ship checklist works for both a draft (freeze → export/install → connect → shadow → approve → enable) and an installed app, with Enable locked until shadow evidence is approved in both paths
- [ ] Activity shows a paused run, deep-links to Seats for approval, and the run detail is the same schematic with run states; outcome follow-ups visible with due state
- [ ] Navigation/reload never loses a draft or a completed scaffold; journey state is identical in library row, header pill, and journey bar
- [ ] Seats/HITL behaviour unchanged (Console under the new name); Desk `typecheck` + `build` pass; shell `installed-apps.test.ts` still passes

## Non-goals

- Freeform node editing (schematic stays read-only, YAML is truth)
- New Spec semantics, scaffolder changes, or live-write Desk runs beyond existing shadow/live gating
- Server-side draft persistence (D2 follow-on), multi-Desk sync, marketplace
- Redesigning Seats / Watch / Gateway or the stream windows (rename Console → Seats only)
- **My Desk** — personal virtual computer. Do not add a rail item, route, or placeholder surface. Tracked in [`desk_my_desk.plan.md`](./desk_my_desk.plan.md).

## Risks

| Risk | Mitigation |
|---|---|
| Hash routing vs Tauri WebView | w1 spike; state-only fallback keeps all views identical |
| `body` missing after manual YAML edits (D4) | re-validate on drawer close; `yaml` dep is the documented escape hatch |
| Two Ship backends diverge in checklist semantics | single adapter interface + acceptance test both paths (w8) |
| Big-bang rewrite of a 1,650-line surface | slice order above; old surface reachable until w9 cutover |
| Draft-store data loss (localStorage quota/eviction) | cap + export-YAML affordance retained; D2 follow-on noted in library footer copy |

## Log

- 2026-10-31 — Plan opened from Flowstep workspace prototype (Specs library/new + Design/Verify/Ship/Activity) and copy pass; gaps confirmed in code: no library/creation entry, frozen Specs not persisted server-side, Desk has no YAML parser (server returns parsed `body`).
- 2026-10-31 — Rail locked: Seats · Build · Apps. Build library is in-progress only; Apps is approved-fleet management (not the same authoring workspace). My Desk split to [`desk_my_desk.plan.md`](./desk_my_desk.plan.md) (backlog, design-first).
- 2026-10-31 — **w0 done:** rail + `mainTab` → `seats|build|apps`; surface titles/HITL deep-link copy; `--signal-dim` + Flowstep→CSS lock note in `styles.css` / DESIGN.md. No My Desk item. Hash routing deferred to w1.
- 2026-10-31 — **w1 done:** hash routes (`#/seats`, `#/build`, `#/build/new`, `#/build/:id/:view`, `#/apps`, `#/apps/:id`) + `workspace/{routes,journey,header,Workspace}`; placeholder views; SpecSurface/AppsSurface still default for Build/Apps landings.
- 2026-10-31 — **w2 done:** `specs/{draft-store,library,SpecsLibrary}`; `#/build` → library (no `/api/v2/apps` merge); migrate legacy history; Paste YAML door; New spec → `#/build/new` (SpecSurface until w3); row opens workspace; scaffold upserts drafts.
