import type { DeskSettings } from "../../gateway/types.ts";
import {
  approveEvidence,
  enableSchedule,
  exportBundle,
  freezeSpec,
  resolveSlot,
  runSpec,
} from "../../spec/client.ts";
import {
  connectApp,
  getApp,
  installAppJson,
  enableApp,
  shadowRunApp,
  approveAppEvidence,
} from "../../apps/client.ts";
import {
  updateDraft,
  type DraftRecord,
} from "../../specs/draft-store.ts";
import type {
  ShipAction,
  ShipAdapter,
  ShipChecklist,
  ShipSlot,
  ShipStep,
} from "./types.ts";

function readSlots(draft: DraftRecord): ShipSlot[] {
  const raw = draft.body?.slots;
  if (!Array.isArray(raw)) return [];
  const out: ShipSlot[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const s = item as Record<string, unknown>;
    if (typeof s.id !== "string" || !s.id.trim()) continue;
    const needs = Array.isArray(s.needs)
      ? s.needs.filter((n): n is string => typeof n === "string")
      : [];
    const candidatesRaw = Array.isArray(s.candidates) ? s.candidates : [];
    const preferred =
      typeof s.preferredCandidateIndex === "number"
        ? s.preferredCandidateIndex
        : undefined;
    const resolved =
      s.resolved === null || typeof s.resolved === "string"
        ? (s.resolved as string | null)
        : null;
    const candidates = candidatesRaw.flatMap((c, index) => {
      if (!c || typeof c !== "object" || Array.isArray(c)) return [];
      const cand = c as Record<string, unknown>;
      if (typeof cand.binding !== "string" || typeof cand.status !== "string") {
        return [];
      }
      return [
        {
          index,
          binding: cand.binding,
          status: cand.status,
          service: typeof cand.service === "string" ? cand.service : undefined,
          connection:
            typeof cand.connection === "string" ? cand.connection : undefined,
          reason: typeof cand.reason === "string" ? cand.reason : undefined,
          preferred: preferred === index,
          selected: false,
        },
      ];
    });
    if (resolved != null && typeof preferred === "number" && candidates[preferred]) {
      for (const c of candidates) c.selected = c.index === preferred;
    }
    out.push({
      id: s.id,
      needs,
      resolved,
      preferredCandidateIndex: preferred,
      candidates,
    });
  }
  return out;
}

function connectionRefsFromSlots(slots: ShipSlot[]): string[] {
  const refs: string[] = [];
  for (const slot of slots) {
    if (slot.resolved == null) continue;
    const sel =
      slot.candidates.find((c) => c.selected) ??
      (typeof slot.preferredCandidateIndex === "number"
        ? slot.candidates[slot.preferredCandidateIndex]
        : undefined);
    if (sel?.connection) refs.push(sel.connection);
  }
  return [...new Set(refs)];
}

function requiredConnections(draft: DraftRecord, slots: ShipSlot[]): string[] {
  const body = draft.body;
  const raw = body?.connections;
  const fromBody = Array.isArray(raw)
    ? raw.filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    : [];
  return [...new Set([...fromBody, ...connectionRefsFromSlots(slots)])];
}

function buildChecklist(
  draft: DraftRecord,
  connections: Array<{ id: string; connected: boolean }>,
  slots: ShipSlot[]
): ShipChecklist {
  const frozen = draft.status === "frozen" || Boolean(draft.frozenId);
  const installed = Boolean(draft.installedAppId);
  const slotsResolved =
    slots.length === 0 || slots.every((s) => s.resolved != null && s.resolved !== "");
  const allConnected =
    connections.length === 0 || connections.every((c) => c.connected);
  const connectedDone =
    slotsResolved &&
    allConnected &&
    (connections.length === 0 || installed || slots.length > 0);
  const shadowed = Boolean(draft.lastShadowRunId || draft.lastShadow?.runId);
  const approved =
    draft.evidenceApproved === true ||
    Boolean(draft.lastShadow?.evidenceApproval?.approvedAt);
  const enabled = draft.scheduleEnabled === true;

  const slotDetail =
    slots.length === 0
      ? null
      : `${slots.filter((s) => s.resolved).length}/${slots.length} slots resolved`;

  const steps: ShipStep[] = [
    {
      id: "frozen",
      label: "Frozen",
      detail: frozen
        ? draft.frozenId
          ? `id · ${draft.frozenId}`
          : "Spec frozen on this Desk"
        : "Freeze before shadow or install",
      done: frozen,
      actionLabel: frozen ? undefined : "Freeze",
    },
    {
      id: "installed",
      label: "On Apps",
      detail: installed
        ? `app · ${draft.installedAppId}`
        : "Export + install so the fleet can own it",
      done: installed,
      actionLabel: !frozen || installed ? undefined : "Install on Apps",
    },
    {
      id: "connected",
      label: slots.length ? "Bindings" : "Connected",
      detail:
        slots.length > 0
          ? `${slotDetail}${
              connections.length
                ? ` · ${connections.filter((c) => c.connected).length}/${connections.length} ready`
                : ""
            }`
          : connections.length === 0
            ? "No connections required"
            : `${connections.filter((c) => c.connected).length}/${connections.length} ready`,
      done: connectedDone && (connections.length === 0 || installed || slotsResolved),
      actionLabel: undefined,
    },
    {
      id: "shadow",
      label: "Shadow run",
      detail: shadowed
        ? `run · ${draft.lastShadowRunId ?? draft.lastShadow?.runId}`
        : "Live reads · writes simulated",
      done: shadowed,
      actionLabel:
        frozen &&
        connectedDone &&
        (connections.length === 0 || installed) &&
        !shadowed
          ? "Shadow run"
          : undefined,
    },
    {
      id: "approved",
      label: "Evidence approved",
      detail: approved
        ? draft.lastShadow?.evidenceApproval?.approvedAt ?? "approved"
        : "Review simulated writes, then approve",
      done: approved,
      actionLabel: shadowed && !approved ? "Approve evidence" : undefined,
    },
    {
      id: "enabled",
      label: "Enabled",
      detail: enabled ? "Schedule unlocked" : "Locked until evidence is approved",
      done: enabled,
      actionLabel: approved && !enabled ? "Enable" : undefined,
    },
  ];

  const next = steps.find((s) => !s.done);

  return {
    steps,
    nextStepId: next?.id,
    canEnable: approved && !enabled,
    note: draft.lastShadow?.note,
    connections,
    slots,
    evidence: {
      runId: draft.lastShadowRunId ?? draft.lastShadow?.runId,
      evidenceCount: draft.lastShadow?.evidenceCount,
      simulatedWriteCount: draft.lastShadow?.simulatedWriteCount,
      simulatedWrites: draft.lastShadow?.simulatedWrites,
      approved,
      note: draft.lastShadow?.note,
    },
  };
}

export function createDraftShipAdapter(opts: {
  settings: DeskSettings;
  getDraft: () => DraftRecord;
  onDraftUpdated: (draft: DraftRecord) => void;
}): ShipAdapter {
  const { settings, getDraft, onDraftUpdated } = opts;

  const persist = (patch: Partial<DraftRecord>): DraftRecord => {
    const cur = getDraft();
    const next = updateDraft(cur.id, patch) ?? { ...cur, ...patch };
    onDraftUpdated(next);
    return next;
  };

  const loadConnections = async (
    draft: DraftRecord,
    slots: ShipSlot[]
  ): Promise<Array<{ id: string; connected: boolean }>> => {
    const required = requiredConnections(draft, slots);
    if (!required.length) return [];
    if (!draft.installedAppId) {
      return required.map((id) => ({ id, connected: false }));
    }
    const res = await getApp(settings, draft.installedAppId);
    const map = res.app?.connections ?? {};
    return required.map((id) => ({
      id,
      connected: Boolean(map[id]?.connected),
    }));
  };

  const refresh = async (): Promise<ShipChecklist> => {
    const draft = getDraft();
    const slots = readSlots(draft);
    const connections = await loadConnections(draft, slots);
    return buildChecklist(draft, connections, slots);
  };

  const run = async (
    action: ShipAction,
    actionOpts?: { connection?: string; slotId?: string; candidateIndex?: number }
  ): Promise<{ checklist: ShipChecklist; note?: string }> => {
    let draft = getDraft();
    let note: string | undefined;

    switch (action) {
      case "freeze": {
        const res = await freezeSpec(settings, draft.yaml);
        if (!res.ok) throw new Error(res.error || "Freeze failed");
        draft = persist({
          status: "frozen",
          frozenId: res.spec?.id,
          yaml: res.yaml ?? draft.yaml,
        });
        note = res.spec ? `Frozen · ${res.spec.id}` : "Frozen";
        break;
      }
      case "install": {
        const exported = await exportBundle(settings, draft.yaml);
        if (!exported.ok || !exported.bundle) {
          throw new Error(exported.error || "Bundle export failed");
        }
        const installed = await installAppJson(
          settings,
          JSON.stringify(exported.bundle)
        );
        if (!installed.ok || !installed.app) {
          throw new Error(installed.error || "Install failed");
        }
        draft = persist({
          status: "frozen",
          installedAppId: installed.app.id,
          specHash: installed.app.specHash || draft.specHash,
        });
        note = installed.note ?? `Installed · ${installed.app.id}`;
        break;
      }
      case "connect": {
        const conn = actionOpts?.connection;
        if (!conn) throw new Error("Pick a connection");
        if (!draft.installedAppId) {
          throw new Error("Install on Apps first");
        }
        const res = await connectApp(settings, draft.installedAppId, conn, true);
        if (!res.ok) throw new Error(res.error || "Connect failed");
        note = res.note ?? `Connected · ${conn}`;
        break;
      }
      case "resolve_slot": {
        const slotId = actionOpts?.slotId;
        const candidateIndex = actionOpts?.candidateIndex;
        if (!slotId || candidateIndex === undefined) {
          throw new Error("Pick a slot candidate");
        }
        const res = await resolveSlot(settings, {
          yaml: draft.yaml,
          body: draft.body,
          slotId,
          candidateIndex,
        });
        if (!res.ok || !res.yaml || !res.body) {
          throw new Error(res.error || "Resolve slot failed");
        }
        draft = persist({
          yaml: res.yaml,
          body: res.body,
        });
        note = res.note;
        const connection =
          typeof res.candidate?.connection === "string"
            ? res.candidate.connection
            : undefined;
        if (connection && draft.installedAppId) {
          const connRes = await connectApp(
            settings,
            draft.installedAppId,
            connection,
            true
          );
          if (connRes.ok) {
            note = `${note ?? ""} · marked ${connection} ready`.trim();
          }
        }
        break;
      }
      case "shadow": {
        if (draft.installedAppId) {
          const res = await shadowRunApp(settings, draft.installedAppId);
          if (!res.ok) throw new Error(res.error || "Shadow run failed");
          draft = persist({
            lastShadowRunId: res.runId,
            evidenceApproved: false,
            lastShadow: {
              runId: res.runId,
              ok: res.ok,
              note: res.note,
            },
          });
          note = res.note ?? `Shadow · ${res.runId}`;
        } else {
          const res = await runSpec(settings, draft.yaml, {
            mode: "shadow",
            autoApprove: true,
          });
          if (!res.ok && !res.runId) {
            throw new Error(res.error || "Shadow run failed");
          }
          draft = persist({
            lastShadowRunId: res.runId,
            evidenceApproved: Boolean(res.evidenceApproval?.approvedAt),
            lastShadow: {
              runId: res.runId,
              ok: res.ok,
              evidenceCount: res.evidenceCount,
              simulatedWriteCount: res.simulatedWriteCount,
              simulatedWrites: res.simulatedWrites,
              evidenceApproval: res.evidenceApproval,
              note: res.note,
            },
            specHash: res.specHash ?? draft.specHash,
          });
          note = res.note ?? `Shadow · ${res.runId}`;
        }
        break;
      }
      case "approve": {
        const runId = draft.lastShadowRunId ?? draft.lastShadow?.runId;
        if (draft.installedAppId) {
          const res = await approveAppEvidence(
            settings,
            draft.installedAppId,
            runId
          );
          if (!res.ok) throw new Error(res.error || "Approve failed");
          draft = persist({
            evidenceApproved: true,
            lastShadow: {
              ...draft.lastShadow,
              runId,
              evidenceApproval: {
                approvedAt: new Date().toISOString(),
                note: res.note,
              },
              note: res.note,
            },
          });
          note = res.note ?? "Evidence approved";
        } else {
          if (!runId) throw new Error("No shadow run to approve");
          const res = await approveEvidence(settings, runId, {
            approvedBy: "desk-operator",
          });
          if (!res.ok) throw new Error(res.error || "Approve failed");
          draft = persist({
            evidenceApproved: true,
            lastShadow: {
              ...draft.lastShadow,
              runId,
              evidenceApproval: res.evidenceApproval,
              note: res.note,
            },
          });
          note = res.note ?? "Evidence approved";
        }
        break;
      }
      case "enable": {
        if (draft.installedAppId) {
          const res = await enableApp(settings, draft.installedAppId);
          if (!res.ok) throw new Error(res.error || "Enable failed");
          draft = persist({ scheduleEnabled: true, status: "frozen" });
          note = res.note ?? "Enabled on Apps";
        } else {
          const res = await enableSchedule(settings, draft.yaml, {
            runId: draft.lastShadowRunId,
          });
          if (!res.ok) throw new Error(res.error || "Enable blocked");
          draft = persist({ scheduleEnabled: true });
          note = res.note ?? "Schedule unlocked";
        }
        break;
      }
    }

    const checklist = await refresh();
    return { checklist, note };
  };

  return { kind: "draft", refresh, run };
}
