import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type { DeskSettings } from "../../gateway/types.ts";
import { listAppRuns, pauseApp, thawApp } from "../../apps/client.ts";
import type { AppRunSummary } from "../../apps/types.ts";
import {
  getRun,
  listRuns,
  processOutcomes,
  type SpecRunListItem,
} from "../../spec/client.ts";
import {
  deriveSchematic,
  type SchematicNode,
  type SchematicRunState,
  slotBindingPlainLabel,
} from "../../spec/schematic.ts";
import type { OutcomeFollowUp, RunResponse } from "../../spec/types.ts";
import {
  updateDraft,
  type DraftRecord,
} from "../../specs/draft-store.ts";

export type ActivityViewProps = {
  draft: DraftRecord;
  settings: DeskSettings;
  onDraftUpdated: (draft: DraftRecord) => void;
  onOpenSeats: () => void;
  onEditSpec: () => void;
};

type ActivityRow = {
  runId: string;
  status: string;
  mode: string;
  updatedAt: string;
  evidenceApproved?: boolean;
  outcomeFollowUpCount?: number;
  outcomeCompleteCount?: number;
  evidenceCount?: number;
};

function summarizeStatus(status: string): string {
  const s = status.toLowerCase();
  if (s === "waiting_you" || s.includes("wait") || s.includes("hitl") || s.includes("pause")) {
    return "Waiting for you";
  }
  if (s === "aborted" || s.includes("fail") || s.includes("error") || s.includes("abort")) {
    return s === "aborted" ? "Aborted" : "Failed";
  }
  if (s === "complete" || s.includes("complete") || s === "ok" || s === "succeeded") {
    return "Finished";
  }
  if (s === "running" || s.includes("run")) return "Running";
  return status;
}

function isHitlPaused(status: string): boolean {
  const s = status.toLowerCase();
  return (
    s === "waiting_you" ||
    s.includes("pause") ||
    s.includes("wait") ||
    s.includes("hitl") ||
    s.includes("human")
  );
}

function runStateLabel(state: SchematicRunState | undefined): string {
  switch (state) {
    case "done":
      return "done";
    case "waiting":
      return "waiting";
    case "simulated":
      return "simulated";
    case "skipped":
      return "skipped";
    case "error":
      return "error";
    default:
      return "pending";
  }
}

function toRowsFromSpec(runs: SpecRunListItem[]): ActivityRow[] {
  return runs.map((r) => ({
    runId: r.runId,
    status: r.status,
    mode: r.mode,
    updatedAt: r.updatedAt,
    evidenceApproved: r.evidenceApproved,
    outcomeFollowUpCount: r.outcomeFollowUpCount,
    outcomeCompleteCount: r.outcomeCompleteCount,
    evidenceCount: r.evidenceCount,
  }));
}

function toRowsFromApp(runs: AppRunSummary[]): ActivityRow[] {
  return runs.map((r) => ({
    runId: r.runId,
    status: r.status,
    mode: r.mode,
    updatedAt: r.updatedAt,
    evidenceApproved: r.evidenceApproved,
    outcomeFollowUpCount: r.outcomeFollowUpCount,
    outcomeCompleteCount: r.outcomeCompleteCount,
    evidenceCount: r.evidenceCount,
  }));
}

function NodeRun({ node }: { node: SchematicNode }) {
  return (
    <div
      class="sch-node sch-node-static"
      data-kind={node.kind === "hitl" ? "hitl" : node.kind}
      data-run={node.runState ?? "pending"}
    >
      <span class="sch-node-label">{node.label}</span>
      {node.use ? <span class="sch-node-use mono">{node.use}</span> : null}
      {node.slot ? (
        <span class="sch-node-slot" data-slot-state={node.slot.state}>
          {slotBindingPlainLabel(node.slot)}
        </span>
      ) : null}
      <span class="sch-badge" data-kind={node.runState === "waiting" ? "hitl" : "once"}>
        {runStateLabel(node.runState)}
      </span>
    </div>
  );
}

export function ActivityView({
  draft,
  settings,
  onDraftUpdated,
  onOpenSeats,
  onEditSpec,
}: ActivityViewProps) {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [note, setNote] = useState<string | undefined>();
  const [detail, setDetail] = useState<{
    run: RunResponse;
    followUps: OutcomeFollowUp[];
  } | null>(null);

  const refreshList = useCallback(async () => {
    setError(undefined);
    try {
      if (draft.installedAppId) {
        const res = await listAppRuns(settings, draft.installedAppId);
        if (!res.ok) throw new Error(res.error || "List runs failed");
        setRows(toRowsFromApp(res.runs ?? []));
      } else if (draft.specHash) {
        const res = await listRuns(settings, {
          specHash: draft.specHash,
          limit: 40,
        });
        if (!res.ok) throw new Error(res.error || "List runs failed");
        setRows(toRowsFromSpec(res.runs ?? []));
      } else if (draft.lastShadowRunId) {
        setRows([
          {
            runId: draft.lastShadowRunId,
            status: draft.lastShadow?.ok === false ? "paused" : "complete",
            mode: "shadow",
            updatedAt: draft.updatedAt,
            evidenceApproved: draft.evidenceApproved,
            evidenceCount: draft.lastShadow?.evidenceCount,
          },
        ]);
      } else {
        setRows([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [draft, settings]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const loadDetail = useCallback(
    async (runId: string) => {
      setSelectedId(runId);
      setBusy(true);
      setError(undefined);
      try {
        const res = await getRun(settings, runId);
        if (!res.ok || !res.run) {
          throw new Error(res.error || "Run not found");
        }
        const run: RunResponse = {
          ok: res.run.status !== "failed" && res.run.status !== "aborted",
          runId: res.run.runId ?? runId,
          mode: res.run.mode as RunResponse["mode"],
          state: res.run.state ?? res.run.status,
          specHash: res.run.specHash,
          stepOutputs: res.run.stepOutputs,
          evidence: res.run.evidence,
          evidenceCount: res.run.evidence?.length,
          evidenceApproval:
            res.evidenceApproval ?? res.run.evidenceApproval,
          outcomeFollowUps:
            res.outcomeFollowUps ?? res.run.outcomeFollowUps,
          simulatedWrites: res.simulatedWrites,
          simulatedWriteCount: res.simulatedWrites?.length,
        };
        setDetail({
          run,
          followUps: run.outcomeFollowUps ?? [],
        });
      } catch (err) {
        setDetail(null);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [settings]
  );

  useEffect(() => {
    if (selectedId || !rows.length) return;
    const hitl = rows.find((r) => isHitlPaused(r.status));
    void loadDetail((hitl ?? rows[0]!).runId);
  }, [rows, selectedId, loadDetail]);

  const schematic = useMemo(() => {
    if (!detail) {
      return deriveSchematic({ body: draft.body, manifest: draft.manifest });
    }
    return deriveSchematic({
      body: draft.body,
      manifest: draft.manifest,
      run: detail.run,
    });
  }, [draft.body, draft.manifest, detail]);

  const onProcessOutcomes = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      const res = await processOutcomes(settings, {
        specHash: draft.specHash ?? detail?.run.specHash,
        now: new Date(Date.now() + 365 * 24 * 3_600_000).toISOString(),
        value: 1,
      });
      if (!res.ok) throw new Error(res.error || "Outcome process failed");
      setNote(res.note ?? `Processed ${res.processed ?? 0}`);
      if (selectedId) await loadDetail(selectedId);
      await refreshList();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [
    settings,
    draft.specHash,
    detail?.run.specHash,
    selectedId,
    loadDetail,
    refreshList,
  ]);

  const onPause = useCallback(async () => {
    if (!draft.installedAppId) {
      setError("Pause applies after the app is on Apps");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const res = await pauseApp(settings, draft.installedAppId);
      if (!res.ok) throw new Error(res.error || "Pause failed");
      setNote("Paused on Apps");
      const updated = updateDraft(draft.id, { scheduleEnabled: false });
      if (updated) onDraftUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [draft, settings, onDraftUpdated]);

  const onEdit = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (draft.installedAppId) {
        const res = await thawApp(settings, draft.installedAppId);
        if (!res.ok) throw new Error(res.error || "Thaw failed");
        const updated = updateDraft(draft.id, {
          yaml: res.yaml ?? draft.yaml,
          status: "draft",
          scheduleEnabled: false,
          evidenceApproved: false,
          frozenId: undefined,
        });
        if (updated) onDraftUpdated(updated);
        setNote(res.note ?? "Thawed — re-gates required");
      } else {
        const updated = updateDraft(draft.id, {
          status: "draft",
          scheduleEnabled: false,
          evidenceApproved: false,
          frozenId: undefined,
        });
        if (updated) onDraftUpdated(updated);
      }
      onEditSpec();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [draft, settings, onDraftUpdated, onEditSpec]);

  const selected = rows.find((r) => r.runId === selectedId);
  const dueFollowUps = (detail?.followUps ?? []).filter(
    (f) => f.status === "pending"
  );

  return (
    <div class="activity-view">
      <section class="tile">
        <div class="tile-stack">
          <div class="tile-head">
            <p class="tile-label">Activity</p>
            <div class="cta-row">
              <button
                type="button"
                class="cta ghost"
                disabled={busy}
                onClick={() => void refreshList()}
              >
                Refresh
              </button>
              <button
                type="button"
                class="cta ghost"
                disabled={busy || !draft.installedAppId}
                title={
                  draft.installedAppId
                    ? "Pause schedule on Apps"
                    : "Install & enable first"
                }
                onClick={() => void onPause()}
              >
                Pause
              </button>
              <button
                type="button"
                class="cta linkish"
                disabled={busy}
                onClick={() => void onEdit()}
              >
                Edit spec
              </button>
            </div>
          </div>
          {!rows.length ? (
            <p class="tile-meta">
              No runs yet — Ship a shadow or live pass to see activity here.
            </p>
          ) : (
            <ul class="activity-list" aria-label="Runs">
              {rows.map((r) => (
                <li key={r.runId}>
                  <button
                    type="button"
                    class="activity-row"
                    data-active={selectedId === r.runId ? "1" : "0"}
                    data-hitl={isHitlPaused(r.status) ? "1" : "0"}
                    onClick={() => void loadDetail(r.runId)}
                  >
                    <span class="activity-row-title">
                      {summarizeStatus(r.status)}
                    </span>
                    <span class="tile-meta mono">
                      {r.mode} · {r.runId.slice(0, 14)}…
                      {r.evidenceApproved ? " · evidence✓" : ""}
                      {r.outcomeFollowUpCount
                        ? ` · outcomes ${r.outcomeCompleteCount ?? 0}/${r.outcomeFollowUpCount}`
                        : ""}
                    </span>
                    <span class="tile-meta mono">{r.updatedAt}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {note ? <p class="tile-meta mono">{note}</p> : null}
          {error ? <p class="error">{error}</p> : null}
        </div>
      </section>

      {selected && isHitlPaused(selected.status) ? (
        <section class="tile activity-hitl">
          <div class="tile-stack">
            <p class="tile-label">HITL</p>
            <h2 class="tile-title">This run is waiting for you</h2>
            <p class="tile-meta">Approve or abort from Seats.</p>
            <div class="cta-row">
              <button type="button" class="cta" onClick={onOpenSeats}>
                Open Seats
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <section class="tile">
        <div class="tile-stack">
          <div class="tile-head">
            <p class="tile-label">Run detail</p>
            <button
              type="button"
              class="cta ghost"
              disabled={busy || !draft.specHash}
              onClick={() => void onProcessOutcomes()}
            >
              Process outcomes
            </button>
          </div>
          {!selectedId ? (
            <p class="tile-meta">Select a run</p>
          ) : busy && !detail ? (
            <p class="tile-meta">Loading…</p>
          ) : (
            <>
              <div class="sch-canvas activity-canvas" aria-label="Run overlay">
                {schematic.trigger ? (
                  <NodeRun node={schematic.trigger} />
                ) : null}
                {schematic.steps.map((step, i) => (
                  <div key={step.id} class="sch-flow">
                    {i > 0 || schematic.trigger ? (
                      <span class="sch-edge" aria-hidden="true">
                        ↓
                      </span>
                    ) : null}
                    <NodeRun node={step} />
                  </div>
                ))}
              </div>
              {dueFollowUps.length ? (
                <div class="activity-outcomes">
                  <p class="tile-label">Outcome follow-ups due</p>
                  <ul class="spec-rule-list">
                    {dueFollowUps.map((f) => (
                      <li key={`${f.ruleId}-${f.dueAt}`}>
                        <span class="mono">{f.ruleId}</span>
                        <span class="muted">
                          {" "}
                          · {f.metricName} · due {f.dueAt}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : detail?.followUps?.length ? (
                <p class="tile-meta mono">
                  outcomes ·{" "}
                  {
                    detail.followUps.filter((f) => f.status === "complete")
                      .length
                  }
                  /{detail.followUps.length} complete
                </p>
              ) : null}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
