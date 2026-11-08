/**
 * Map Desk schematic → xyflow nodes/edges. Spec remains source of truth.
 *
 * Trigger/schedule is a frame around the spine, not step 0.
 */

import type { Edge, Node } from "@xyflow/react";
import type { SchematicModel, SchematicNode } from "../../spec/schematic.ts";

export const FLOW_STEP_TYPE = "relayStep" as const;
export const FLOW_FRAME_TYPE = "relayFrame" as const;

export const NODE_WIDTH = 280;

/** Fixed HITL diamond AABB (matches `--sch-hitl-side` in CSS). */
export const HITL_SIZE = 200;

/** Padding inside the trigger frame around the spine. */
export const FRAME_PAD_X = 28;
export const FRAME_PAD_Y = 24;
export const FRAME_HEADER_H = 40;

/** MiniMap only helps once the spine is long enough to lose place (sc3). */
export const MINIMAP_MIN_STEPS = 8;

export type NodeSize = { width: number; height: number };

export type FlowStepData = {
  schematic: SchematicNode;
  label: string;
};

export type FlowFrameData = {
  schematic: SchematicNode;
  label: string;
  kindLabel: string;
};

export type RelayFlowNode = Node<FlowStepData, typeof FLOW_STEP_TYPE>;
export type RelayFrameNode = Node<FlowFrameData, typeof FLOW_FRAME_TYPE>;
export type RelayCanvasNode = RelayFlowNode | RelayFrameNode;

/** Initial stack before measure + dagre (sc1/sc2). */
const PLACEHOLDER_STRIDE_Y = 140;
const START_X = 80;
const START_Y = 40;

export function isFlowStepNode(n: RelayCanvasNode): n is RelayFlowNode {
  return n.type === FLOW_STEP_TYPE;
}

export function isFlowFrameNode(n: RelayCanvasNode): n is RelayFrameNode {
  return n.type === FLOW_FRAME_TYPE;
}

export function humanStepTitle(node: SchematicNode): string {
  if (node.kind === "trigger") {
    return triggerKindLabel(node);
  }
  const id = node.id.toLowerCase();
  if (id === "scout") return "Scout issues";
  if (id === "draft") return "Draft comments";
  if (id === "post") return "Post comment";
  if (id === "approve" || node.kind === "hitl") return "Approve";
  if (node.label && node.label !== node.id) return node.label;
  return node.id
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Schedule / Poll / Manual / Trigger — frame chrome, not a spine title. */
export function triggerKindLabel(node: SchematicNode): string {
  const label = node.label?.trim() ?? "";
  if (/^schedule/i.test(label)) return "Schedule";
  if (/^poll/i.test(label)) return "Poll";
  if (/^manual$/i.test(label)) return "Manual";
  const args = node.args;
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const t = args as Record<string, unknown>;
    if (t.schedule) return "Schedule";
    if (t.poll) return "Poll";
    if (t.manual === true || t.manual) return "Manual";
  }
  return "Trigger";
}

export function hitlSupportingLine(node: SchematicNode): string {
  const prompt = node.args?.prompt;
  if (typeof prompt === "string" && prompt.trim()) return prompt.trim();
  return "Ask operator before continuing";
}

export function schematicToFlowElements(model: SchematicModel): {
  nodes: RelayCanvasNode[];
  edges: Edge[];
  signature: string;
  spineIds: string[];
} {
  const trigger = model.trigger;
  const steps = model.nodes.filter((n) => n.kind !== "trigger");
  const hasFrame = Boolean(trigger);

  const stepNodes: RelayFlowNode[] = steps.map((schematic, index) => {
    const hitl = schematic.kind === "hitl";
    const w = hitl ? HITL_SIZE : NODE_WIDTH;
    const h = hitl ? HITL_SIZE : undefined;
    return {
      id: schematic.id,
      type: FLOW_STEP_TYPE,
      position: {
        x: hasFrame ? FRAME_PAD_X : START_X,
        y: hasFrame
          ? FRAME_HEADER_H + FRAME_PAD_Y + index * PLACEHOLDER_STRIDE_Y
          : START_Y + index * PLACEHOLDER_STRIDE_Y,
      },
      data: {
        schematic,
        label: humanStepTitle(schematic),
      },
      parentId: hasFrame && trigger ? trigger.id : undefined,
      draggable: false,
      selectable: true,
      width: w,
      height: h,
      style: hitl
        ? { width: HITL_SIZE, height: HITL_SIZE }
        : { width: NODE_WIDTH },
    };
  });

  const edges: Edge[] = [];
  for (let i = 1; i < steps.length; i++) {
    const from = steps[i - 1]!;
    const to = steps[i]!;
    const ref = to.fromRef ?? to.forEach;
    edges.push({
      id: `e-${from.id}-${to.id}`,
      source: from.id,
      target: to.id,
      type: "smoothstep",
      selectable: false,
      focusable: false,
      data: ref ? { ref } : undefined,
    });
  }

  const nodes: RelayCanvasNode[] = [];
  if (trigger) {
    const roughH =
      FRAME_HEADER_H +
      FRAME_PAD_Y * 2 +
      Math.max(steps.length, 1) * PLACEHOLDER_STRIDE_Y;
    const roughW = NODE_WIDTH + FRAME_PAD_X * 2;
    nodes.push({
      id: trigger.id,
      type: FLOW_FRAME_TYPE,
      position: { x: START_X, y: START_Y },
      data: {
        schematic: trigger,
        label: trigger.label,
        kindLabel: triggerKindLabel(trigger),
      },
      draggable: false,
      selectable: true,
      width: roughW,
      height: roughH,
      style: { width: roughW, height: roughH },
      zIndex: -1,
    });
  }
  nodes.push(...stepNodes);

  const spineIds = steps.map((n) => n.id);
  const triggerSig = trigger
    ? `${trigger.id}:${trigger.label}:${triggerKindLabel(trigger)}`
    : "";

  return {
    nodes,
    edges,
    signature: [triggerSig, ...spineIds].filter(Boolean).join(">"),
    spineIds,
  };
}

/**
 * Edge / forEach ref labels stay hidden until a connected step is selected (sc3).
 */
export function withSelectionEdgeLabels(
  edges: Edge[],
  selectedId: string | undefined
): Edge[] {
  return edges.map((edge) => {
    const ref =
      typeof edge.data === "object" &&
      edge.data &&
      "ref" in edge.data &&
      typeof (edge.data as { ref?: unknown }).ref === "string"
        ? (edge.data as { ref: string }).ref
        : undefined;
    const show =
      Boolean(selectedId) &&
      Boolean(ref) &&
      (edge.source === selectedId || edge.target === selectedId);
    const nextLabel = show ? ref : undefined;
    if (edge.label === nextLabel) return edge;
    return {
      ...edge,
      label: nextLabel,
      labelShowBg: show,
      labelStyle: show
        ? {
            fill: "var(--ink)",
            fontSize: 11,
            fontFamily: "var(--mono, ui-monospace, monospace)",
          }
        : undefined,
      labelBgStyle: show
        ? {
            fill: "var(--panel-2)",
            fillOpacity: 0.92,
          }
        : undefined,
      labelBgPadding: show ? ([4, 6] as [number, number]) : undefined,
      labelBgBorderRadius: show ? 4 : undefined,
    };
  });
}
