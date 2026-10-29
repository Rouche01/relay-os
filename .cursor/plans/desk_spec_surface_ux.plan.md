---
name: Desk Spec surface UX
overview: "Make Relay Desk Spec operable as Intent → scaffold → validate → evals → lower → freeze → dry-run: real pipeline state, gated actions, visible progress/errors, and a first-class dry-run panel. HITL cards stay on Console."
todos:
  - id: pipeline-stepper
    content: "Replace static INTENT→…→RUN breadcrumb with stateful stepper (done / current / blocked) driven by yaml, validation, evals, lowered, frozenId, runResult"
    status: completed
  - id: gate-actions
    content: "Disable Evals until validate ok; Lower/Freeze/Run until evals pass (optional force bypass with explicit confirm); one-line reason when disabled"
    status: completed
  - id: status-rail
    content: "Sticky status strip — llm provider from /api/health, busy label + elapsed, last error; keep aria-live"
    status: completed
  - id: dry-run-panel
    content: "Promote Run dry into its own panel/tabs (Steps / Evidence / Summary) using stepOutputs + evidence from /api/v2/run; not buried under Freeze"
    status: completed
  - id: scaffold-modes
    content: "Scaffold chips for mode llm|stub|needs edits, attempts, Retry; treat partial YAML + validation errors as first-class"
    status: pending
  - id: inline-diagnostics
    content: "Validator issues + eval case table inline (path/stepId, case·pass/fail·rule); jump/highlight YAML when cheap"
    status: pending
  - id: intent-presets
    content: "Intent library presets (CE fashion, freight wedge, blank) instead of single DEFAULT_CE_INTENT only"
    status: pending
  - id: export-copy
    content: "Copy/download YAML, last dry-run JSON, specHash from Freeze/run panel"
    status: pending
  - id: polish-later
    content: "Later — stub vs LLM diff, streaming scaffold progress, Open HITL on Console deep-link, Spec history from shell .data/specs.json"
    status: pending
isProject: true
---

# Desk Spec surface UX

## Why

Dogfooding showed the Spec host/API can run the loop, but the Desk UI does not make the loop **operable**: progress was invisible, evals/run failures were opaque, dry-run results were missing or gated incorrectly, and every action stayed unlocked so order/gates were guesswork.

**North star:** an operator can complete Intent → dry-run without reading server logs, and know exactly which step is current and what blocks the next.

```text
Intent → Scaffold → Validate → Evals → Lower → Freeze → Run dry
                              ↑ gates ↑
HITL cards stay on Console (FEEDBACK_ADAPTER=desk)
```

## Scope

| In | Out |
|----|-----|
| `apps/relay-desk/src/spec/*` + light `styles.css` | Redesigning Console / Watch / Gateway |
| Consume existing shell `/api/v2/*` + `/api/health` (`llmProvider`, `stepOutputs`, `evidence`) | New Spec v2 semantics / scaffolder model quality (track separately) |
| Client-side pipeline state + clearer diagnostics | Streaming LLM tokens (optional later) |

## Phase 1 — Minimum usable loop (ship first)

### 1. Pipeline stepper

- Derive step state from existing React state (`yaml`, `validation`, `evals`, `lowered`, `frozenId`, `runResult`, `busy`).
- Visual: done / current / blocked (reuse Spec breadcrumb language already in the head).
- Clicking a completed step scrolls/focuses that tile (optional but cheap).

### 2. Gate actions

| Action | Enable when |
|--------|-------------|
| Scaffold | Intent non-empty, not busy |
| Validate / Evals | YAML non-empty |
| Evals (strict) | Last validation `ok` |
| Lower / Freeze / Run dry | Evals `report.passed` (or user confirms **Force**) |
| Force | Explicit ghost control — do not hide failures |

Show a single muted line under the CTA row when disabled (e.g. `blocked · evals not passed`).

### 3. Status rail

Sticky under the Spec title:

- `llm · {provider}` from `fetchScaffoldProvider` / probe health
- Busy: label + elapsed seconds while `busy`
- Last error condensed (full text still in error block)

### 4. Dry-run panel

- Split **Freeze** vs **Run dry** visually (two tiles or Freeze actions + Run panel).
- Tabs: **Steps** (`stepOutputs`) · **Evidence** · **Summary** (state, specHash, evidenceCount, note).
- Empty state: “Run dry to populate fixtures + stub LLM trail.”

**Depends on:** current `/api/v2/run` payload (`stepOutputs`, `evidence`) — already added; keep API stable.

## Phase 2 — Operate with confidence

### 5. Scaffold modes

- Chips: `llm` | `stub` | `needs edits` from scaffold `mode` + `ok`.
- Show `attempts`; primary **Retry scaffold**.
- On `needs edits`, keep YAML populated and open Validator tile.

### 6. Inline diagnostics

- Validator: list issues with `path` / `stepId` / `code` (already partially there — tighten).
- Evals: table `caseId · pass/fail · failing rule detail` (replace one-line summary as primary).
- Optional: scroll YAML textarea to first error line if path maps cleanly.

### 7. Intent presets

- Dropdown or chip row: CE fashion (current default), freight wedge stub, blank.
- Presets only set Intent text; do not auto-scaffold.

### 8. Export / copy

- Buttons: Copy YAML · Copy dry-run JSON · Copy specHash.
- Download `.yaml` / `.json` for handoff to engager-gen / review.

## Phase 3 — Later polish

- Diff stub Spec vs last LLM scaffold
- Streaming / step progress for long scaffold
- “Open HITL on Console” when `autoApprove` is off
- Spec history browser over shell `.data/specs.json`

## Files (expected)

- [`apps/relay-desk/src/spec/SpecSurface.tsx`](apps/relay-desk/src/spec/SpecSurface.tsx) — main UI
- [`apps/relay-desk/src/spec/client.ts`](apps/relay-desk/src/spec/client.ts) — health/provider helpers
- [`apps/relay-desk/src/spec/types.ts`](apps/relay-desk/src/spec/types.ts) — response shapes
- [`apps/relay-desk/src/styles.css`](apps/relay-desk/src/styles.css) — stepper, rail, dry-run panel
- Shell API only if Phase 1 reveals missing fields (prefer Desk-only)

## Acceptance

1. Operator can tell current pipeline step without hovering buttons.
2. Cannot accidentally Run dry before evals pass unless Force.
3. During scaffold, status rail shows provider + that work is in progress.
4. After Run dry COMPLETE, Steps tab shows non-empty `stepOutputs` for a CE-like Spec.
5. Evals fail state always shows per-case pass/fail (never bare `evals · fail` alone).

## Non-goals

- Replacing engager-gen CLI dogfood
- Live Reddit network from Desk Run dry (fixtures + stub LLM remain)
- Moving HITL negotiate cards onto Spec tab
