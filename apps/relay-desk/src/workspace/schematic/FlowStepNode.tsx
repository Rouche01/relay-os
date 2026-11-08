import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  slotBindingPlainLabel,
  type SchematicBadge,
  type SchematicNode,
} from "../../spec/schematic.ts";
import {
  hitlSupportingLine,
  type RelayFlowNode,
} from "./flow-model.ts";

function quietBadges(node: SchematicNode, selected: boolean): SchematicBadge[] {
  const out: SchematicBadge[] = [];
  for (const b of node.badges) {
    if (b.kind === "slot" || b.kind === "hitl") continue;
    if (b.kind === "forEach") {
      out.push({ kind: "forEach", itemsRef: "×N items" });
      continue;
    }
    if (
      (b.kind === "once" || b.kind === "when" || b.kind === "retry") &&
      !selected
    ) {
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

function FlowStepNodeImpl({ data, selected }: NodeProps<RelayFlowNode>) {
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

  return (
    <div
      className={`sch-node sch-flow-node${fanOut ? " sch-flow-node-fanout" : ""}`}
      data-kind={kind}
      data-selected={selected ? "1" : "0"}
      data-irreversible={node.irreversible ? "1" : "0"}
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
      {slotLine ? (
        <span
          className="sch-node-bind"
          data-slot-state={node.slot?.state}
          data-degraded={node.slot?.degraded ? "1" : undefined}
        >
          {slotLine}
        </span>
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
      {selected && node.use ? (
        <span className="sch-node-use mono">{node.use}</span>
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
