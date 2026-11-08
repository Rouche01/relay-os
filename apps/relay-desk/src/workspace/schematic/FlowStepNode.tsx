import { memo, useEffect, useRef } from "react";
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
} from "@xyflow/react";
import {
  slotBindingPlainLabel,
  type SchematicBadge,
  type SchematicNode,
} from "../../spec/schematic.ts";
import {
  hitlSupportingLine,
  type NodeSize,
  type RelayFlowNode,
} from "./flow-model.ts";
import { useReportNodeSize } from "./measure-context.tsx";
import { useSchematicActions } from "./schematic-actions.tsx";

function quietBadges(node: SchematicNode, selected: boolean): SchematicBadge[] {
  const out: SchematicBadge[] = [];
  for (const b of node.badges) {
    if (b.kind === "slot" || b.kind === "hitl") continue;
    // forEach / once / when / retry refs stay off the card until selected (sc3).
    if (
      b.kind === "forEach" ||
      b.kind === "once" ||
      b.kind === "when" ||
      b.kind === "retry"
    ) {
      if (!selected) continue;
      out.push(b);
      continue;
    }
    out.push(b);
  }
  return out;
}

function badgeLabel(b: SchematicBadge): string {
  switch (b.kind) {
    case "forEach":
      return `forEach ${b.itemsRef}`;
    case "once":
      return `once · ${b.key}`;
    case "when":
      return `when · ${b.summary}`;
    case "retry":
      return `retry ×${b.max}`;
    case "irreversible":
      return "irreversible";
    case "hitl":
      return "HITL";
    case "slot":
      return slotBindingPlainLabel(b);
  }
}

function FlowStepNodeImpl({ id, data, selected }: NodeProps<RelayFlowNode>) {
  const node = data.schematic;
  const title = data.label;
  const slotLine = node.slot ? slotBindingPlainLabel(node.slot) : undefined;
  const badges = quietBadges(node, Boolean(selected));
  const fanOut = Boolean(node.forEach);
  const kind =
    node.kind === "hitl"
      ? "hitl"
      : node.kind === "trigger"
        ? "trigger"
        : "step";

  const rootRef = useRef<HTMLDivElement>(null);
  const reportSize = useReportNodeSize();
  const updateNodeInternals = useUpdateNodeInternals();
  const actions = useSchematicActions();

  const pickerOpen = Boolean(
    actions && node.slotId && actions.bindingOpenId === id
  );
  const candidates =
    pickerOpen && node.slotId ? actions!.getCandidates(node.slotId) : [];

  const lastSizeRef = useRef<NodeSize | null>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const publish = () => {
      const width = Math.ceil(el.offsetWidth);
      const height = Math.ceil(el.offsetHeight);
      if (width <= 0 || height <= 0) return;
      const prev = lastSizeRef.current;
      const same =
        prev &&
        Math.abs(prev.width - width) < 1 &&
        Math.abs(prev.height - height) < 1;
      if (same) return;
      lastSizeRef.current = { width, height };
      // Quiet sizes are preferred for dagre; after settle, non-baseline
      // reports are ignored so selection chrome doesn’t reflow the spine.
      reportSize(
        id,
        { width, height },
        { baseline: !selected && !pickerOpen }
      );
      updateNodeInternals(id);
    };

    publish();
    const ro = new ResizeObserver(() => publish());
    ro.observe(el);
    return () => ro.disconnect();
  }, [id, reportSize, updateNodeInternals, selected, pickerOpen]);

  const onBindClick = (e: {
    stopPropagation: () => void;
    preventDefault: () => void;
  }) => {
    e.stopPropagation();
    e.preventDefault();
    if (!actions || !node.slotId) return;
    actions.onSelectStep(id);
    actions.setBindingOpenId(actions.bindingOpenId === id ? undefined : id);
  };

  return (
    <div
      ref={rootRef}
      className={`sch-node sch-flow-node${fanOut ? " sch-flow-node-fanout" : ""}`}
      data-kind={kind}
      data-selected={selected ? "1" : "0"}
      data-irreversible={node.irreversible ? "1" : "0"}
      data-bind-open={pickerOpen ? "1" : "0"}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="sch-handle"
        isConnectable={false}
      />
      <div className="sch-node-top">
        <span className="sch-node-label">{title}</span>
        {node.kind === "hitl" ? (
          <span className="sch-badge" data-kind="hitl">
            Needs you
          </span>
        ) : null}
      </div>
      {node.kind === "hitl" ? (
        <span className="sch-node-support">{hitlSupportingLine(node)}</span>
      ) : null}
      {slotLine && node.slot ? (
        <div className="sch-node-bind-wrap">
          <button
            type="button"
            className="sch-node-bind nodrag nopan"
            data-slot-state={node.slot.state}
            data-degraded={node.slot.degraded ? "1" : undefined}
            data-open={pickerOpen ? "1" : "0"}
            aria-expanded={pickerOpen}
            aria-haspopup="listbox"
            title="Change binding"
            onClick={onBindClick}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <span>{slotLine}</span>
            <span className="sch-node-bind-chevron" aria-hidden="true">
              {pickerOpen ? "▴" : "▾"}
            </span>
          </button>
          {pickerOpen ? (
            <div
              className="sch-bind-picker sch-node-bind-picker nodrag nopan"
              role="listbox"
              aria-label="Binding"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {candidates.length === 0 ? (
                <p className="tile-meta muted">No candidates on this Spec</p>
              ) : (
                candidates.map((c) => {
                  const blocked = c.status === "blocked";
                  const degraded = c.status === "degraded";
                  return (
                    <button
                      key={c.index}
                      type="button"
                      className="sch-bind-option"
                      role="option"
                      aria-selected={c.selected}
                      data-selected={c.selected ? "1" : "0"}
                      data-degraded={degraded ? "1" : "0"}
                      disabled={Boolean(actions?.busy) || blocked}
                      title={
                        blocked
                          ? c.reason ?? "Blocked"
                          : c.reason ?? c.label
                      }
                      onClick={() => {
                        if (!node.slotId || !actions) return;
                        actions.onPickCandidate(node.slotId, c.index);
                        actions.setBindingOpenId(undefined);
                      }}
                    >
                      <span>{c.label}</span>
                      <span className="mono muted">
                        {c.selected
                          ? "selected"
                          : degraded
                            ? "degraded"
                            : c.status}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          ) : null}
        </div>
      ) : null}
      {node.kind === "trigger" && node.label ? (
        <span className="sch-node-svc mono">{node.label}</span>
      ) : null}
      {node.operation && node.kind !== "hitl" ? (
        <span className="sch-node-svc mono">{node.operation}</span>
      ) : null}
      {fanOut ? (
        <span className="sch-node-fanout mono">fan-out · forEach</span>
      ) : null}
      {badges.length ? (
        <span className="sch-badges">
          {badges.map((b) => (
            <span
              key={b.kind + badgeLabel(b)}
              className="sch-badge"
              data-kind={b.kind}
            >
              {badgeLabel(b)}
            </span>
          ))}
        </span>
      ) : null}
      <Handle
        type="source"
        position={Position.Bottom}
        className="sch-handle"
        isConnectable={false}
      />
    </div>
  );
}

export const FlowStepNode = memo(FlowStepNodeImpl);
