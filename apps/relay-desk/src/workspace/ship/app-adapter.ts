import type { DeskSettings } from "../../gateway/types.ts";
import type { InstalledAppSummary } from "../../apps/types.ts";
import {
  approveAppEvidence,
  connectApp,
  enableApp,
  getApp,
  shadowRunApp,
} from "../../apps/client.ts";
import type {
  ShipAction,
  ShipAdapter,
  ShipChecklist,
  ShipStep,
} from "./types.ts";

function buildChecklist(
  summary: InstalledAppSummary,
  connections: Array<{ id: string; connected: boolean }>,
  lastShadowRunId?: string,
  evidenceNote?: string
): ShipChecklist {
  const frozen = !summary.editing;
  const installed = true;
  const allConnected =
    connections.length === 0 || connections.every((c) => c.connected);
  const approved = !summary.needsShadowGate;
  const shadowed = approved || Boolean(lastShadowRunId);
  const enabled = summary.scheduleState === "enabled";

  const steps: ShipStep[] = [
    {
      id: "frozen",
      label: "Frozen",
      detail: frozen ? "Bundle frozen" : "Thawed — re-freeze before going live",
      done: frozen,
    },
    {
      id: "installed",
      label: "On Apps",
      detail: summary.id,
      done: installed,
    },
    {
      id: "connected",
      label: "Connected",
      detail:
        connections.length === 0
          ? "No connections required"
          : `${summary.connectionsConnected}/${summary.connectionsRequired} ready`,
      done: allConnected,
    },
    {
      id: "shadow",
      label: "Shadow run",
      detail: lastShadowRunId ? `run · ${lastShadowRunId}` : "Live reads · writes simulated",
      done: shadowed,
      actionLabel:
        frozen && allConnected && !shadowed ? "Shadow run" : undefined,
    },
    {
      id: "approved",
      label: "Evidence approved",
      detail: approved ? "Shadow gate passed" : "Approve simulated writes",
      done: approved,
      actionLabel: shadowed && !approved ? "Approve evidence" : undefined,
    },
    {
      id: "enabled",
      label: "Enabled",
      detail:
        summary.scheduleState === "paused"
          ? "Paused"
          : enabled
            ? "Schedule on"
            : "Locked until evidence is approved",
      done: enabled,
      actionLabel:
        approved && !enabled && frozen ? "Enable" : undefined,
    },
  ];

  const next = steps.find((s) => !s.done && s.actionLabel);
  return {
    steps,
    nextStepId: next?.id,
    canEnable: approved && !enabled && frozen,
    note: evidenceNote,
    connections,
    evidence: {
      runId: lastShadowRunId,
      approved,
      note: evidenceNote,
    },
  };
}

export function createAppShipAdapter(opts: {
  settings: DeskSettings;
  appId: string;
  onSummary?: (summary: InstalledAppSummary) => void;
}): ShipAdapter {
  const { settings, appId, onSummary } = opts;
  let lastShadowRunId: string | undefined;
  let lastNote: string | undefined;

  const refresh = async (): Promise<ShipChecklist> => {
    const res = await getApp(settings, appId);
    if (!res.ok || !res.summary) {
      throw new Error(res.error || "App not found");
    }
    onSummary?.(res.summary);
    const required =
      res.app?.bundle.requiredConnections ??
      Object.keys(res.app?.connections ?? {});
    const map = res.app?.connections ?? {};
    const connections = required.map((id) => ({
      id,
      connected: Boolean(map[id]?.connected),
    }));
    lastShadowRunId = res.app?.lastShadowRunId ?? lastShadowRunId;
    return buildChecklist(res.summary, connections, lastShadowRunId, lastNote);
  };

  const run = async (
    action: ShipAction,
    actionOpts?: { connection?: string }
  ): Promise<{ checklist: ShipChecklist; note?: string }> => {
    let note: string | undefined;
    switch (action) {
      case "freeze":
        throw new Error("Use Refreeze on Apps for installed apps");
      case "install":
        throw new Error("Already installed");
      case "connect": {
        const conn = actionOpts?.connection;
        if (!conn) throw new Error("Pick a connection");
        const res = await connectApp(settings, appId, conn, true);
        if (!res.ok) throw new Error(res.error || "Connect failed");
        if (res.app) onSummary?.(res.app);
        note = res.note ?? `Connected · ${conn}`;
        break;
      }
      case "shadow": {
        const res = await shadowRunApp(settings, appId);
        if (!res.ok) throw new Error(res.error || "Shadow run failed");
        lastShadowRunId = res.runId ?? lastShadowRunId;
        if (res.app) onSummary?.(res.app);
        note = res.note ?? `Shadow · ${res.runId}`;
        lastNote = note;
        break;
      }
      case "approve": {
        const res = await approveAppEvidence(settings, appId, lastShadowRunId);
        if (!res.ok) throw new Error(res.error || "Approve failed");
        if (res.app) onSummary?.(res.app);
        note = res.note ?? "Evidence approved";
        lastNote = note;
        break;
      }
      case "enable": {
        const res = await enableApp(settings, appId);
        if (!res.ok) throw new Error(res.error || "Enable failed");
        if (res.app) onSummary?.(res.app);
        note = res.note ?? "Enabled";
        lastNote = note;
        break;
      }
    }
    return { checklist: await refresh(), note };
  };

  return { kind: "app", refresh, run };
}
