/**
 * Zoomable Design schematic via @xyflow/react (Preact compat).
 * Spec / YAML remains source of truth — canvas is a projection.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type NodeTypes,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ComponentChildren } from "preact";
import type { SchematicModel } from "../../spec/schematic.ts";
import { FlowStepNode } from "./FlowStepNode.tsx";
import {
  FLOW_STEP_TYPE,
  schematicToFlowElements,
  type RelayFlowNode,
} from "./flow-model.ts";

export type SchematicCanvasProps = {
  model: SchematicModel;
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
  inspector: ComponentChildren;
  footer?: ComponentChildren;
};

const nodeTypes: NodeTypes = {
  [FLOW_STEP_TYPE]: FlowStepNode,
};

function withSelection(
  nodes: RelayFlowNode[],
  selectedId: string | undefined
): RelayFlowNode[] {
  return nodes.map((n) => ({
    ...n,
    selected: Boolean(selectedId && n.id === selectedId),
  }));
}

function SchematicCanvasInner({
  model,
  selectedId,
  onSelect,
  inspector,
  footer,
}: SchematicCanvasProps) {
  const { fitView } = useReactFlow();
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const fittedForRef = useRef<string>("");

  const elements = useMemo(() => schematicToFlowElements(model), [model]);
  const [nodes, setNodes, onNodesChange] = useNodesState(
    withSelection(elements.nodes, selectedId)
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(elements.edges);

  useEffect(() => {
    setNodes(withSelection(elements.nodes, selectedRef.current));
    setEdges(elements.edges);
  }, [elements, setNodes, setEdges]);

  useEffect(() => {
    setNodes((prev: RelayFlowNode[]) => {
      let changed = false;
      const next = prev.map((n) => {
        const selected = Boolean(selectedId && n.id === selectedId);
        if (n.selected === selected) return n;
        changed = true;
        return { ...n, selected };
      });
      return changed ? next : prev;
    });
  }, [selectedId, setNodes]);

  useEffect(() => {
    if (!elements.signature || fittedForRef.current === elements.signature) {
      return;
    }
    const timer = window.setTimeout(() => {
      fittedForRef.current = elements.signature;
      void fitView({ padding: 0.2, duration: 0 });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [elements.signature, fitView]);

  const onSelectionChange = useCallback(
    ({ nodes: selected }: OnSelectionChangeParams) => {
      const next = selected[0]?.id;
      if (next !== selectedRef.current) onSelect(next);
    },
    [onSelect]
  );

  const onInit = useCallback(() => {
    if (fittedForRef.current === elements.signature) return;
    fittedForRef.current = elements.signature;
    void fitView({ padding: 0.2, duration: 0 });
  }, [elements.signature, fitView]);

  return (
    <div className="sch-viewport sch-viewport-flow">
      <div className="sch-flow-main">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onSelectionChange={onSelectionChange}
          onPaneClick={() => onSelect(undefined)}
          onInit={onInit}
          minZoom={0.3}
          maxZoom={1.8}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          selectNodesOnDrag={false}
          panOnScroll
          zoomOnScroll
          zoomOnPinch
          panOnDrag
          preventScrolling
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ type: "smoothstep" }}
          onlyRenderVisibleElements={false}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={16}
            size={1}
            color="var(--line)"
          />
          <Controls showInteractive={false} position="top-left" />
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            maskColor="color-mix(in srgb, var(--void) 70%, transparent)"
            nodeColor={(n) => {
              const kind = (n.data as { schematic?: { kind?: string } })
                ?.schematic?.kind;
              if (kind === "hitl") {
                return "color-mix(in srgb, var(--signal) 55%, var(--panel-2))";
              }
              return "color-mix(in srgb, var(--signal) 30%, var(--panel-2))";
            }}
          />
          {footer ? (
            <Panel
              position="bottom-left"
              className="sch-flow-meta-panel"
              aria-label="Schematic meta"
            >
              {footer}
            </Panel>
          ) : null}
        </ReactFlow>
      </div>
      <div className="sch-inspector-dock">{inspector}</div>
    </div>
  );
}

export function SchematicCanvas(props: SchematicCanvasProps) {
  return (
    <ReactFlowProvider>
      <SchematicCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
