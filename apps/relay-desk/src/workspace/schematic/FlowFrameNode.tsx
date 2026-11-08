/**
 * Trigger / schedule wrapper around the step spine — not a peer step.
 */

import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { RelayFrameNode } from "./flow-model.ts";

function FlowFrameNodeImpl({ data, selected }: NodeProps<RelayFrameNode>) {
  return (
    <div
      className="sch-flow-frame"
      data-selected={selected ? "1" : "0"}
      aria-label={`${data.kindLabel}: ${data.label}`}
    >
      <div className="sch-flow-frame-head">
        <span className="sch-flow-frame-kind">{data.kindLabel}</span>
        {data.label && data.label !== data.kindLabel ? (
          <span className="sch-flow-frame-detail mono">{data.label}</span>
        ) : null}
      </div>
    </div>
  );
}

export const FlowFrameNode = memo(FlowFrameNodeImpl);
