/**
 * Vertical spine layout for Design schematic (dagre TB).
 * Trigger frame wraps the laid-out spine — not a dagre peer.
 */

import * as dagre from "@dagrejs/dagre";
import type { Edge } from "@xyflow/react";
import {
  FRAME_HEADER_H,
  FRAME_PAD_X,
  FRAME_PAD_Y,
  FLOW_FRAME_TYPE,
  FLOW_STEP_TYPE,
  HITL_SIZE,
  NODE_WIDTH,
  isFlowFrameNode,
  isFlowStepNode,
  type NodeSize,
  type RelayCanvasNode,
  type RelayFlowNode,
  type RelayFrameNode,
} from "./flow-model.ts";

const RANK_SEP = 80;
const NODE_SEP = 32;
const MARGIN = 48;
const FALLBACK_HEIGHT = 112;

function layoutSteps(
  steps: RelayFlowNode[],
  edges: Edge[],
  sizes: Readonly<Record<string, NodeSize>>
): RelayFlowNode[] {
  if (steps.length === 0) return steps;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "TB",
    nodesep: NODE_SEP,
    ranksep: RANK_SEP,
    marginx: MARGIN,
    marginy: MARGIN,
  });

  for (const node of steps) {
    const hitl = node.data.schematic.kind === "hitl";
    const measured = sizes[node.id];
    g.setNode(node.id, {
      width: hitl
        ? HITL_SIZE
        : (measured?.width ?? node.width ?? NODE_WIDTH),
      height: hitl
        ? HITL_SIZE
        : (measured?.height ?? node.height ?? FALLBACK_HEIGHT),
    });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return steps.map((node) => {
    const laid = g.node(node.id);
    if (!laid) return node;
    const hitl = node.data.schematic.kind === "hitl";
    const width = hitl ? HITL_SIZE : (laid.width ?? NODE_WIDTH);
    const height = hitl ? HITL_SIZE : (laid.height ?? FALLBACK_HEIGHT);
    return {
      ...node,
      position: {
        x: laid.x - width / 2,
        y: laid.y - height / 2,
      },
      width,
      height,
      style: hitl
        ? { width: HITL_SIZE, height: HITL_SIZE }
        : { ...(node.style ?? {}), width },
    };
  });
}

function wrapInFrame(
  frame: RelayFrameNode,
  steps: RelayFlowNode[]
): RelayCanvasNode[] {
  if (steps.length === 0) {
    const w = NODE_WIDTH + FRAME_PAD_X * 2;
    const h = FRAME_HEADER_H + FRAME_PAD_Y * 2 + FALLBACK_HEIGHT;
    return [
      {
        ...frame,
        position: frame.position,
        width: w,
        height: h,
        style: { ...(frame.style ?? {}), width: w, height: h },
        zIndex: -1,
      },
    ];
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const step of steps) {
    const w = step.width ?? NODE_WIDTH;
    const h = step.height ?? FALLBACK_HEIGHT;
    minX = Math.min(minX, step.position.x);
    minY = Math.min(minY, step.position.y);
    maxX = Math.max(maxX, step.position.x + w);
    maxY = Math.max(maxY, step.position.y + h);
  }

  const frameX = minX - FRAME_PAD_X;
  const frameY = minY - FRAME_PAD_Y - FRAME_HEADER_H;
  const frameW = maxX - minX + FRAME_PAD_X * 2;
  const frameH = maxY - minY + FRAME_PAD_Y * 2 + FRAME_HEADER_H;

  const framedSteps: RelayFlowNode[] = steps.map((step) => ({
    ...step,
    parentId: frame.id,
    position: {
      x: step.position.x - frameX,
      y: step.position.y - frameY,
    },
  }));

  const framed: RelayFrameNode = {
    ...frame,
    position: { x: frameX, y: frameY },
    width: frameW,
    height: frameH,
    style: { ...(frame.style ?? {}), width: frameW, height: frameH },
    zIndex: -1,
  };

  return [framed, ...framedSteps];
}

export function layoutVerticalSpine(
  nodes: RelayCanvasNode[],
  edges: Edge[],
  sizes: Readonly<Record<string, NodeSize>>
): RelayCanvasNode[] {
  if (nodes.length === 0) return nodes;

  const frame = nodes.find(isFlowFrameNode);
  const steps = nodes.filter(isFlowStepNode);
  const laidSteps = layoutSteps(steps, edges, sizes);

  if (!frame) {
    return laidSteps.map((step) => ({
      ...step,
      parentId: undefined,
    }));
  }

  return wrapInFrame(frame, laidSteps);
}

/** True when every spine step id has a measured size (frame is derived). */
export function allNodesMeasured(
  nodeIds: readonly string[],
  sizes: Readonly<Record<string, NodeSize>>
): boolean {
  return nodeIds.every((id) => {
    const s = sizes[id];
    return Boolean(s && s.width > 0 && s.height > 0);
  });
}

export function spineIdsFromNodes(nodes: readonly RelayCanvasNode[]): string[] {
  return nodes.filter((n) => n.type === FLOW_STEP_TYPE).map((n) => n.id);
}

export function frameIdFromNodes(
  nodes: readonly RelayCanvasNode[]
): string | undefined {
  return nodes.find((n) => n.type === FLOW_FRAME_TYPE)?.id;
}
