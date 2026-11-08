/**
 * Map Desk schematic → xyflow nodes/edges. Spec remains source of truth.
 */

import type { Edge, Node } from "@xyflow/react";
import type { SchematicModel, SchematicNode } from "../../spec/schematic.ts";

export const FLOW_STEP_TYPE = "relayStep" as const;

export type FlowStepData = {
  schematic: SchematicNode;
  label: string;
};

export type RelayFlowNode = Node<FlowStepData, typeof FLOW_STEP_TYPE>;

const NODE_WIDTH = 280;
const NODE_STRIDE_Y = 160;
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
      y: START_Y + index * NODE_STRIDE_Y,
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
    edges.push({
      id: `e-${from.id}-${to.id}`,
      source: from.id,
      target: to.id,
      type: "smoothstep",
      selectable: false,
      focusable: false,
    });
  }

  return {
    nodes,
    edges,
    signature: ordered.map((n) => n.id).join(">"),
  };
}
