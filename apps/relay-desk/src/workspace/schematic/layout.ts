/**
 * Vertical spine layout for Design schematic (dagre TB).
 * Positions use measured node sizes when available.
 */

import * as dagre from "@dagrejs/dagre";
import type { Edge } from "@xyflow/react";
import {
  NODE_WIDTH,
  type NodeSize,
  type RelayFlowNode,
} from "./flow-model.ts";

const RANK_SEP = 56;
const NODE_SEP = 32;
const MARGIN = 48;
const FALLBACK_HEIGHT = 112;

export function layoutVerticalSpine(
  nodes: RelayFlowNode[],
  edges: Edge[],
  sizes: Readonly<Record<string, NodeSize>>
): RelayFlowNode[] {
  if (nodes.length === 0) return nodes;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "TB",
    nodesep: NODE_SEP,
    ranksep: RANK_SEP,
    marginx: MARGIN,
    marginy: MARGIN,
  });

  for (const node of nodes) {
    const measured = sizes[node.id];
    g.setNode(node.id, {
      width: measured?.width ?? node.width ?? NODE_WIDTH,
      height: measured?.height ?? node.height ?? FALLBACK_HEIGHT,
    });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const laid = g.node(node.id);
    if (!laid) return node;
    const width = laid.width ?? NODE_WIDTH;
    const height = laid.height ?? FALLBACK_HEIGHT;
    return {
      ...node,
      position: {
        x: laid.x - width / 2,
        y: laid.y - height / 2,
      },
      width,
      height,
      style: { ...(node.style ?? {}), width },
    };
  });
}

/** True when every node id has a measured size (or nodes is empty). */
export function allNodesMeasured(
  nodeIds: readonly string[],
  sizes: Readonly<Record<string, NodeSize>>
): boolean {
  return nodeIds.every((id) => {
    const s = sizes[id];
    return Boolean(s && s.width > 0 && s.height > 0);
  });
}
