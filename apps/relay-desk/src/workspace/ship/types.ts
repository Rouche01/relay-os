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

/** Capability slot row for Ship resolve UX (cs3). */
export type ShipSlotCandidate = {
  index: number;
  binding: string;
  status: string;
  service?: string;
  connection?: string;
  reason?: string;
  /** True when this is the scaffold preferred index (still requires click). */
  preferred?: boolean;
  selected?: boolean;
};

export type ShipSlot = {
  id: string;
  needs: string[];
  resolved?: string | null;
  preferredCandidateIndex?: number;
  candidates: ShipSlotCandidate[];
};

export type ShipChecklist = {
  steps: ShipStep[];
  /** Next actionable step id (first incomplete with an action). */
  nextStepId?: ShipStepId;
  canEnable: boolean;
  note?: string;
  connections?: Array<{ id: string; connected: boolean }>;
  /** Capability slots to resolve before / with connections (cs3). */
  slots?: ShipSlot[];
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
  | "resolve_slot"
  | "shadow"
  | "approve"
  | "enable";

export type ShipAdapter = {
  kind: "draft" | "app";
  refresh: () => Promise<ShipChecklist>;
  run: (
    action: ShipAction,
    opts?: { connection?: string; slotId?: string; candidateIndex?: number }
  ) => Promise<{ checklist: ShipChecklist; note?: string }>;
};
