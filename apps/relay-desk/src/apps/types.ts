export type InstalledAppSummary = {
  id: string;
  goal: string;
  specHash: string;
  scheduleState: "disabled" | "enabled" | "paused";
  needsShadowGate: boolean;
  editing: boolean;
  connectionsConnected: number;
  connectionsRequired: number;
  installedAt: string;
  updatedAt: string;
};

export type AppRunSummary = {
  runId: string;
  status: string;
  mode: string;
  updatedAt: string;
  evidenceCount: number;
  evidenceApproved?: boolean;
  outcomeFollowUpCount?: number;
  outcomeCompleteCount?: number;
};
