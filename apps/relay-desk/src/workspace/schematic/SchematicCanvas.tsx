/**
 * Zoomable Design schematic via @xyflow/react (Preact compat).
 * Spec / YAML remains source of truth — canvas is a projection.
 *
 * Permanent visibility rule: keep this mounted and sized under Design
 * covers (Manifest/YAML / other stages). Never visibility:hidden on RF.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
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
import { FlowFrameNode } from "./FlowFrameNode.tsx";
import { FlowStepNode } from "./FlowStepNode.tsx";
import {
  FLOW_FRAME_TYPE,
  FLOW_STEP_TYPE,
  MINIMAP_MIN_STEPS,
  isFlowFrameNode,
  isFlowStepNode,
  schematicToFlowElements,
  withSelectionEdgeLabels,
  type NodeSize,
  type RelayCanvasNode,
} from "./flow-model.ts";
import { allNodesMeasured, layoutVerticalSpine } from "./layout.ts";
import { NodeMeasureProvider } from "./measure-context.tsx";
import {
  SchematicActionsProvider,
  type SchematicActions,
} from "./schematic-actions.tsx";

export type SchematicCanvasProps = {
  model: SchematicModel;
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
  inspector: ComponentChildren;
  actions: SchematicActions;
};

const nodeTypes: NodeTypes = {
  [FLOW_STEP_TYPE]: FlowStepNode,
  [FLOW_FRAME_TYPE]: FlowFrameNode,
};

const FIT_PADDING = 0.16;
const MIN_HOST = 48;

function withSelection(
  nodes: RelayCanvasNode[],
  selectedId: string | undefined
): RelayCanvasNode[] {
  return nodes.map((n) => ({
    ...n,
    selected: Boolean(selectedId && n.id === selectedId),
  }));
}

function patchNodeData(
  prev: RelayCanvasNode[],
  nextNodes: RelayCanvasNode[],
  selectedId: string | undefined
): RelayCanvasNode[] {
  if (prev.length !== nextNodes.length) {
    return withSelection(nextNodes, selectedId);
  }
  const byId = new Map(nextNodes.map((n) => [n.id, n]));
  let changed = false;
  const out = prev.map((n) => {
    const fresh = byId.get(n.id);
    if (!fresh || fresh.type !== n.type) {
      changed = true;
      return n;
    }
    const selected = Boolean(selectedId && n.id === selectedId);
    if (isFlowStepNode(n) && isFlowStepNode(fresh)) {
      if (
        n.data.schematic === fresh.data.schematic &&
        n.data.label === fresh.data.label &&
        n.selected === selected
      ) {
        return n;
      }
      changed = true;
      return { ...n, data: fresh.data, selected };
    }
    if (isFlowFrameNode(n) && isFlowFrameNode(fresh)) {
      if (
        n.data.schematic === fresh.data.schematic &&
        n.data.label === fresh.data.label &&
        n.data.kindLabel === fresh.data.kindLabel &&
        n.selected === selected
      ) {
        return n;
      }
      changed = true;
      return { ...n, data: fresh.data, selected };
    }
    changed = true;
    return { ...fresh, selected };
  });
  return changed ? out : prev;
}

function SchematicCanvasInner({
  model,
  selectedId,
  onSelect,
  inspector,
  actions,
}: SchematicCanvasProps) {
  const { fitView } = useReactFlow();
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const fitViewRef = useRef(fitView);
  fitViewRef.current = fitView;

  const sizesRef = useRef<Record<string, NodeSize>>({});
  const settledSignatureRef = useRef<string>("");
  const fittedKeyRef = useRef<string>("");
  const layoutTimerRef = useRef<number>(0);
  const signatureRef = useRef<string>("");
  const flowHostRef = useRef<HTMLDivElement>(null);

  const elements = useMemo(() => schematicToFlowElements(model), [model]);
  const elementsRef = useRef(elements);
  elementsRef.current = elements;
  const signature = elements.signature;
  signatureRef.current = signature;

  const showMiniMap = elements.spineIds.length >= MINIMAP_MIN_STEPS;
  const [nodes, setNodes, onNodesChange] = useNodesState(
    withSelection(elements.nodes, selectedId)
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    withSelectionEdgeLabels(elements.edges, selectedId)
  );

  const applyLayout = useCallback(
    (sizes: Readonly<Record<string, NodeSize>>) => {
      const els = elementsRef.current;
      const laidOut = layoutVerticalSpine(els.nodes, els.edges, sizes);
      setNodes(withSelection(laidOut, selectedRef.current));
      setEdges(withSelectionEdgeLabels(els.edges, selectedRef.current));
    },
    [setNodes, setEdges]
  );

  const tryFitView = useCallback((force = false) => {
    const host = flowHostRef.current;
    if (!host) return false;
    const { width, height } = host.getBoundingClientRect();
    if (width < MIN_HOST || height < MIN_HOST) return false;

    const key = `${signatureRef.current}:${Math.round(width)}x${Math.round(height)}`;
    if (!force && fittedKeyRef.current === key) return true;

    fittedKeyRef.current = key;
    window.requestAnimationFrame(() => {
      void fitViewRef.current({ padding: FIT_PADDING, duration: 0 });
    });
    return true;
  }, []);

  const settleMeasuredLayout = useCallback(
    (opts?: { fit?: boolean }) => {
      const els = elementsRef.current;
      if (!allNodesMeasured(els.spineIds, sizesRef.current)) return;

      const first = settledSignatureRef.current !== els.signature;
      settledSignatureRef.current = els.signature;
      applyLayout(sizesRef.current);
      // Snap to content on select/unselect — but don't fitView (zoom thrash).
      if (opts?.fit || first) tryFitView(true);
    },
    [applyLayout, tryFitView]
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
        settleMeasuredLayout();
      }, 48);
    },
    [settleMeasuredLayout]
  );

  useEffect(() => {
    sizesRef.current = {};
    settledSignatureRef.current = "";
    fittedKeyRef.current = "";
    applyLayout({});
    const t0 = window.setTimeout(() => tryFitView(true), 0);
    const t1 = window.setTimeout(() => tryFitView(true), 50);
    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
      window.clearTimeout(layoutTimerRef.current);
    };
  }, [signature, applyLayout, tryFitView]);

  useEffect(() => {
    if (settledSignatureRef.current && settledSignatureRef.current !== signature) {
      return;
    }
    setNodes((prev) =>
      patchNodeData(prev, elements.nodes, selectedRef.current)
    );
    setEdges(
      withSelectionEdgeLabels(elements.edges, selectedRef.current)
    );
  }, [elements, signature, setNodes, setEdges]);

  useEffect(() => {
    setNodes((prev: RelayCanvasNode[]) => {
      let changed = false;
      const next = prev.map((n) => {
        const selected = Boolean(selectedId && n.id === selectedId);
        if (n.selected === selected) return n;
        changed = true;
        return { ...n, selected };
      });
      return changed ? next : prev;
    });
    setEdges((prev) => {
      const next = withSelectionEdgeLabels(
        elementsRef.current.edges,
        selectedId
      );
      if (
        prev.length === next.length &&
        prev.every(
          (e, i) => e.label === next[i]?.label && e.id === next[i]?.id
        )
      ) {
        return prev;
      }
      return next;
    });
  }, [selectedId, setNodes, setEdges]);

  useEffect(() => {
    const host = flowHostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      tryFitView(false);
    });
    ro.observe(host);
    tryFitView(true);
    return () => ro.disconnect();
  }, [tryFitView, signature]);

  const onSelectionChange = useCallback(
    ({ nodes: selected }: OnSelectionChangeParams) => {
      const next = selected[0]?.id;
      if (next !== selectedRef.current) {
        onSelectRef.current(next);
        const a = actionsRef.current;
        if (a.bindingOpenId && a.bindingOpenId !== next) {
          a.setBindingOpenId(undefined);
        }
      }
    },
    []
  );

  const onNodeDoubleClick = useCallback(
    (_: unknown, node: { id: string; type?: string; data: unknown }) => {
      if (node.type === FLOW_FRAME_TYPE) return;
      const data = node.data as { schematic?: { kind?: string } };
      const kind = data.schematic?.kind;
      if (kind === "step" || kind === "hitl") {
        actionsRef.current.onJumpToYaml(node.id);
      }
    },
    []
  );

  const onPaneClick = useCallback(() => {
    onSelectRef.current(undefined);
    actionsRef.current.setBindingOpenId(undefined);
  }, []);

  return (
    <SchematicActionsProvider value={actions}>
      <NodeMeasureProvider report={reportSize}>
        <div className="sch-viewport sch-viewport-flow">
          <div className="sch-flow-main" ref={flowHostRef}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onSelectionChange={onSelectionChange}
              onNodeDoubleClick={onNodeDoubleClick}
              onPaneClick={onPaneClick}
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
              fitView={false}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={16}
                size={1}
                color="var(--line)"
              />
              <Controls showInteractive={false} position="top-left" />
              {showMiniMap ? (
                <MiniMap
                  pannable
                  zoomable
                  position="bottom-right"
                  maskColor="color-mix(in srgb, var(--void) 70%, transparent)"
                  nodeColor={(n) => {
                    if (n.type === FLOW_FRAME_TYPE) {
                      return "color-mix(in srgb, var(--line) 55%, var(--panel-2))";
                    }
                    const kind = (n.data as { schematic?: { kind?: string } })
                      ?.schematic?.kind;
                    if (kind === "hitl") {
                      return "color-mix(in srgb, var(--signal) 55%, var(--panel-2))";
                    }
                    return "color-mix(in srgb, var(--signal) 30%, var(--panel-2))";
                  }}
                />
              ) : null}
            </ReactFlow>
          </div>
          <div className="sch-inspector-dock">{inspector}</div>
        </div>
      </NodeMeasureProvider>
    </SchematicActionsProvider>
  );
}

export function SchematicCanvas(props: SchematicCanvasProps) {
  return (
    <ReactFlowProvider>
      <SchematicCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
