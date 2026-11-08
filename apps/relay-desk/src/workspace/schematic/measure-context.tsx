import type { ComponentChildren } from "preact";
import { createContext, useContext } from "react";
import type { NodeSize } from "./flow-model.ts";

export type ReportNodeSizeOpts = {
  /** Quiet card size used for dagre — ignore selection / picker chrome. */
  baseline?: boolean;
};

export type ReportNodeSize = (
  id: string,
  size: NodeSize,
  opts?: ReportNodeSizeOpts
) => void;

const NodeMeasureContext = createContext<ReportNodeSize | null>(null);

export function NodeMeasureProvider({
  report,
  children,
}: {
  report: ReportNodeSize;
  children: ComponentChildren;
}) {
  return (
    <NodeMeasureContext.Provider value={report}>
      {children}
    </NodeMeasureContext.Provider>
  );
}

export function useReportNodeSize(): ReportNodeSize {
  const report = useContext(NodeMeasureContext);
  return report ?? (() => undefined);
}
