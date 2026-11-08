import type { ComponentChildren } from "preact";
import { createContext, useContext } from "react";

export type BindingCandidate = {
  index: number;
  label: string;
  status: string;
  reason?: string;
  selected: boolean;
};

export type SchematicActions = {
  busy: boolean;
  bindingOpenId: string | undefined;
  setBindingOpenId: (id: string | undefined) => void;
  getCandidates: (slotId: string) => BindingCandidate[];
  onPickCandidate: (slotId: string, candidateIndex: number) => void;
  onJumpToYaml: (stepId: string) => void;
  onSelectStep: (id: string) => void;
};

const SchematicActionsContext = createContext<SchematicActions | null>(null);

export function SchematicActionsProvider({
  value,
  children,
}: {
  value: SchematicActions;
  children: ComponentChildren;
}) {
  return (
    <SchematicActionsContext.Provider value={value}>
      {children}
    </SchematicActionsContext.Provider>
  );
}

export function useSchematicActions(): SchematicActions | null {
  return useContext(SchematicActionsContext);
}
