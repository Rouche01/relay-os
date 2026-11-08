/**
 * Zoomable Design schematic via @xyflow/react (Preact compat).
 * Spec / YAML remains source of truth — canvas is a projection.
 * sc1/sc2: measure node boxes → dagre TB layout → fitView once.
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
  type NodeSize,
  type RelayFlowNode,
} from "./flow-model.ts";
import { allNodesMeasured, layoutVerticalSpine } from "./layout.ts";
import { NodeMeasureProvider } from "./measure-context.tsx";

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
  const sizesRef = useRef<Record<string, NodeSize>>({});
  const layoutPassRef = useRef<string>("");
  const layoutTimerRef = useRef<number>(0);

  const elements = useMemo(() => schematicToFlowElements(model), [model]);
  const [nodes, setNodes, onNodesChange] = useNodesState(
    withSelection(elements.nodes, selectedId)
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(elements.edges);

  const runLayout = useCallback(
    (reason: "measure" | "signature") => {
      const ids = elements.nodes.map((n) => n.id);
      const measured = allNodesMeasured(ids, sizesRef.current);
      // Prefer full measure; still layout with fallbacks on signature so first paint isn’t stacked.
      if (!measured && reason === "measure") return;

      const laidOut = layoutVerticalSpine(
        elements.nodes,
        elements.edges,
        sizesRef.current
      );
      setNodes(withSelection(laidOut, selectedRef.current));
      setEdges(elements.edges);

      const passKey = `${elements.signature}::${measured ? "m" : "f"}`;
      if (layoutPassRef.current === passKey) return;
      layoutPassRef.current = passKey;

      window.requestAnimationFrame(() => {
        void fitView({ padding: 0.2, duration: 0 });
      });
    },
    [elements, setNodes, setEdges, fitView]
  );

  const reportSize = useCallback(
    (id: string, size: NodeSize) => {
      const prev = sizesRef.current[id];
      if (
        prev &&
        Math.abs(prev.width - size.width) < 1 &&
        Math.abs(prev.height - size.height) < 1
      ) {
        return;
      }
      sizesRef.current = { ...sizesRef.current, [id]: size };
      window.clearTimeout(layoutTimerRef.current);
      layoutTimerRef.current = window.setTimeout(() => {
        runLayout("measure");
      }, 48);
    },
    [runLayout]
  );

  useEffect(() => {
    sizesRef.current = {};
    layoutPassRef.current = "";
    setNodes(withSelection(elements.nodes, selectedRef.current));
    setEdges(elements.edges);
    // Placeholder stack until measures arrive; also layout with fallbacks so edges exist.
    const t = window.setTimeout(() => runLayout("signature"), 0);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(layoutTimerRef.current);
    };
  }, [elements.signature, elements, setNodes, setEdges, runLayout]);

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

  const onSelectionChange = useCallback(
    ({ nodes: selected }: OnSelectionChangeParams) => {
      const next = selected[0]?.id;
      if (next !== selectedRef.current) onSelect(next);
    },
    [onSelect]
  );

  return (
    <NodeMeasureProvider report={reportSize}>
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
    </NodeMeasureProvider>
  );
}

export function SchematicCanvas(props: SchematicCanvasProps) {
  return (
    <ReactFlowProvider>
      <SchematicCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
