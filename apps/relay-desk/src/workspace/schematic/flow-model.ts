/**
 * Map Desk schematic → xyflow nodes/edges. Spec remains source of truth.
 */

import type { Edge, Node } from "@xyflow/react";
import type { SchematicModel, SchematicNode } from "../../spec/schematic.ts";

export const FLOW_STEP_TYPE = "relayStep" as const;

export const NODE_WIDTH = 280;

/** MiniMap only helps once the spine is long enough to lose place (sc3). */
export const MINIMAP_MIN_STEPS = 8;

export type NodeSize = { width: number; height: number };

export type FlowStepData = {
  schematic: SchematicNode;
  label: string;
};

export type RelayFlowNode = Node<FlowStepData, typeof FLOW_STEP_TYPE>;

/** Initial stack before measure + dagre (sc1/sc2). */
const PLACEHOLDER_STRIDE_Y = 140;
const START_X = 80;
const START_Y = 40;

export function humanStepTitle(node: SchematicNode): string {
  if (node.kind === "trigger") return "Schedule";
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

export function hitlSupportingLine(node: SchematicNode): string {
  const prompt = node.args?.prompt;
  if (typeof prompt === "string" && prompt.trim()) return prompt.trim();
  return "Ask operator before continuing";
}

export function schematicToFlowElements(model: SchematicModel): {
  nodes: RelayFlowNode[];
  edges: Edge[];
  signature: string;
} {
  const ordered = model.nodes;
  const nodes: RelayFlowNode[] = ordered.map((schematic, index) => ({
    id: schematic.id,
    type: FLOW_STEP_TYPE,
    position: {
      x: START_X,
      y: START_Y + index * PLACEHOLDER_STRIDE_Y,
    },
    data: {
      schematic,
      label: humanStepTitle(schematic),
    },
    draggable: false,
    selectable: true,
    width: NODE_WIDTH,
    style: { width: NODE_WIDTH },
  }));

  const edges: Edge[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const from = ordered[i - 1]!;
    const to = ordered[i]!;
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

  return {
    nodes,
    edges,
    signature: ordered.map((n) => n.id).join(">"),
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
