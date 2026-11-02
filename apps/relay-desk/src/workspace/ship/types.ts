/** Unified going-live checklist — one UI, two backends (D3). */

export type ShipStepId =
  | "frozen"
  | "installed"
  | "connected"
  | "shadow"
  | "approved"
  | "enabled";

export type ShipStep = {
  id: ShipStepId;
  label: string;
  detail?: string;
  done: boolean;
  /** Primary action for this step when it's the next incomplete one. */
  actionLabel?: string;
};

export type ShipChecklist = {
  steps: ShipStep[];
  /** Next actionable step id (first incomplete with an action). */
  nextStepId?: ShipStepId;
  canEnable: boolean;
  note?: string;
  connections?: Array<{ id: string; connected: boolean }>;
  evidence?: {
    runId?: string;
    evidenceCount?: number;
    simulatedWriteCount?: number;
    simulatedWrites?: Array<{ stepId?: string; detail?: unknown }>;
    approved?: boolean;
    note?: string;
  };
};

export type ShipAction =
  | "freeze"
  | "install"
  | "connect"
  | "shadow"
  | "approve"
  | "enable";

export type ShipAdapter = {
  kind: "draft" | "app";
  refresh: () => Promise<ShipChecklist>;
  run: (
    action: ShipAction,
    opts?: { connection?: string }
  ) => Promise<{ checklist: ShipChecklist; note?: string }>;
};
