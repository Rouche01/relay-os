---
name: Desk Design schematic canvas
overview: "Polish Design Schematic into a stable, zoomable Spec projection (xyflow + Preact): auto-layout, measured nodes, quiet chrome, binding-on-node CTA — without freeform graph edit. Spec/YAML stays source of truth."
todos:
  - id: sc0-baseline
    content: Baseline locked — @xyflow/react via Preact compat; custom relayStep nodes; floating Rules/meta Panel; Controls top-left; fitView once per flow signature; inspector dock; no freeform connect/drag
    status: completed
  - id: sc1-auto-layout
    content: Auto-layout vertical spine with dagre or ELK after node measure — replace fixed NODE_STRIDE_Y; fitView once after layout settles
    status: completed
  - id: sc2-measure-nodes
    content: Measure real node heights (ResizeObserver / useUpdateNodeInternals) so HITL / fan-out cards don’t overlap edges or confuse fitView
    status: completed
  - id: sc3-quiet-chrome
    content: Hide MiniMap until step count ≥ ~8; keep Controls + sticky Rules/meta; optional edge/ref labels only when a step is selected
    status: completed
  - id: sc4-binding-cta
    content: Uses GitHub (slot bind control) on the node is the primary CTA — click opens binding picker (inspector can stay secondary); double-click node → Jump to YAML
    status: completed
  - id: sc5-preact-guardrails
    content: Document Preact island rules for xyflow (hooks from react/compat only, className, stable nodeTypes, single fitView per signature); optional Design smoke assert nodes rendered
    status: pending
  - id: sc6-gated-edit-later
    content: Later — insert/reorder steps only via Spec patches (validate → refresh canvas). Out of scope until sc1–sc5 stable; never free wiring that invents engine verbs
    status: pending
isProject: true
---

# Desk — Design schematic canvas

Follow-on to completed [`desk_spec_workspace_ux.plan.md`](./desk_spec_workspace_ux.plan.md) (w5–w6 schematic model + Design view) and sibling to [`relay_intent_slots_engine_bridge.plan.md`](./relay_intent_slots_engine_bridge.plan.md) (slots visible on Design; binding resolve on Ship). Flowstep reference: Design · uniform cards / binding picker screens on [Relay Desk](https://app.flowstep.ai/file?activeFileId=a7a26c2d-f42b-4309-955c-7f931d81c6fe).

## Why

w6 shipped a readable schematic; xyflow then gave pan/zoom/fit. Remaining gaps are **layout correctness**, **quiet chrome**, and **slot UX on the node** — not a second authoring surface.

## Non-negotiables

1. **Spec / YAML is source of truth** — canvas is a projection of `deriveSchematic`.
2. **No freeform node wiring** — connect/drag-to-rewire stays off; gated Spec patches only (sc6).
3. **Preact + xyflow** — treat Design schematic as a compat island (hooks/`className`/stable `nodeTypes`).
4. **Capability slots** — binding swaps stay Spec-law preserving (`args.slot` + Ship resolve); Design shows truth, doesn’t invent live APIs.

## In scope

| ID | Work |
|----|------|
| sc1 | dagre/ELK vertical layout + one fit after measure |
| sc2 | Real node height measurement |
| sc3 | MiniMap threshold; select-only edge/ref detail |
| sc4 | Binding control on node + dblclick → YAML |
| sc5 | Compat guardrails + light smoke |
| sc6 | (Later) Spec-patch insert/reorder only |

## Out of scope

- LLM slot propose / engine-bridge docs → [`relay_intent_slots_engine_bridge.plan.md`](./relay_intent_slots_engine_bridge.plan.md) (`is2`–`is5`)
- Ship resolve UX, Verify/Activity overlays beyond sharing `deriveSchematic`
- Replacing Preact with React, or a Workflow-Builder product SDK

## Suggested sequencing

1. ~~sc0 baseline~~ (xyflow + floating meta + fit once)
2. **sc2 + sc1** together (measure then layout)
3. sc3 quiet chrome
4. sc4 binding CTA
5. sc5 guardrails/smoke
6. sc6 only after Design feels stable

## Success criteria

1. GitHub triage spine: no overlapping cards; fitView lands all steps without zoom thrash.
2. Rules/meta stays viewport-sticky while panning/zooming.
3. Operator can change binding from the step card without hunting the inspector first.
4. Empty-canvas / Preact blank regression caught by a cheap check or documented island rules.

## Code pointers

- [`apps/relay-desk/src/workspace/schematic/SchematicCanvas.tsx`](../../apps/relay-desk/src/workspace/schematic/SchematicCanvas.tsx)
- [`apps/relay-desk/src/workspace/schematic/FlowStepNode.tsx`](../../apps/relay-desk/src/workspace/schematic/FlowStepNode.tsx)
- [`apps/relay-desk/src/workspace/schematic/flow-model.ts`](../../apps/relay-desk/src/workspace/schematic/flow-model.ts)
- [`apps/relay-desk/src/workspace/views/DesignView.tsx`](../../apps/relay-desk/src/workspace/views/DesignView.tsx)
- [`apps/relay-desk/src/spec/schematic.ts`](../../apps/relay-desk/src/spec/schematic.ts)

## Log

- 2026-11-08 — Plan opened from Design canvas review (auto-layout, measure, quiet chrome, binding CTA, Preact guardrails; gated Spec edit later). sc0 baseline already in tree.
- 2026-11-08 — sc2+sc1: `@dagrejs/dagre` TB layout (`layout.ts`); ResizeObserver + `useUpdateNodeInternals` via `measure-context`; fitView once after measure settles (`SchematicCanvas`).
- 2026-11-08 — sc3: MiniMap gated at ≥8 steps; forEach/once/when/retry badges + edge ref labels only when connected step selected; Controls + Rules panel unchanged.
- 2026-11-08 — sc4: slot bind control on node opens inline picker (`schematic-actions`); inspector picker secondary; double-click step/HITL → Jump to YAML.