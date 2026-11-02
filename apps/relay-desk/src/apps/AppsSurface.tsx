import { useCallback, useEffect, useState } from "preact/hooks";
import type { DeskSettings } from "../gateway/types.ts";
import {
  connectApp,
  disableApp,
  enableApp,
  getApp,
  installAppJson,
  listAppRuns,
  listApps,
  pauseApp,
  resumeApp,
  thawApp,
  uninstallApp,
} from "./client.ts";
import type { AppRunSummary, InstalledAppSummary } from "./types.ts";
import {
  loadDrafts,
  updateDraft,
  upsertDraft,
  type DraftRecord,
} from "../specs/draft-store.ts";
import type { DeskRoute } from "../workspace/routes.ts";

type Props = {
  settings: DeskSettings;
  /** Selected app from hash `#/apps/:id` (optional). */
  selectedAppId?: string;
  onNavigate: (route: DeskRoute) => void;
};

function schedulePhrase(state: InstalledAppSummary["scheduleState"]): string {
  switch (state) {
    case "enabled":
      return "Live";
    case "paused":
      return "Paused";
    default:
      return "Disabled";
  }
}

function summarizeRunStatus(status: string): string {
  const s = status.toLowerCase();
  if (s === "waiting_you" || s.includes("wait")) return "Waiting for you";
  if (s === "aborted") return "Aborted";
  if (s.includes("fail") || s.includes("error")) return "Failed";
  if (s === "complete") return "Finished";
  if (s === "running") return "Running";
  return status;
}

function draftForApp(appId: string): DraftRecord | undefined {
  return loadDrafts().find((d) => d.installedAppId === appId);
}

export function AppsSurface({ settings, selectedAppId, onNavigate }: Props) {
  const [apps, setApps] = useState<InstalledAppSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>(
    selectedAppId
  );
  const [installJson, setInstallJson] = useState("");
  const [connections, setConnections] = useState<
    Record<string, { connected: boolean }>
  >({});
  const [required, setRequired] = useState<string[]>([]);
  const [runs, setRuns] = useState<AppRunSummary[]>([]);
  const [note, setNote] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSelectedId(selectedAppId);
  }, [selectedAppId]);

  const selectApp = useCallback(
    (id: string | undefined) => {
      setSelectedId(id);
      onNavigate(id ? { kind: "apps-detail", appId: id } : { kind: "apps" });
    },
    [onNavigate]
  );

  const refreshList = useCallback(async () => {
    const res = await listApps(settings);
    if (!res.ok) {
      setError(res.error || "Failed to list apps");
      return;
    }
    setApps(res.apps ?? []);
  }, [settings]);

  const refreshSelected = useCallback(
    async (id: string) => {
      const res = await getApp(settings, id);
      if (!res.ok) {
        setError(res.error || "Failed to load app");
        return;
      }
      setConnections(res.app?.connections ?? {});
      setRequired(res.app?.bundle.requiredConnections ?? []);
      const runRes = await listAppRuns(settings, id);
      if (runRes.ok) setRuns(runRes.runs ?? []);
    },
    [settings]
  );

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    if (selectedId) void refreshSelected(selectedId);
    else {
      setConnections({});
      setRequired([]);
      setRuns([]);
    }
  }, [selectedId, refreshSelected]);

  const selected = apps.find((a) => a.id === selectedId);

  const run = async (
    label: string,
    fn: () => Promise<{
      ok: boolean;
      error?: string;
      note?: string;
      app?: InstalledAppSummary;
    }>
  ) => {
    setBusy(true);
    setError(undefined);
    setNote(undefined);
    try {
      const res = await fn();
      if (!res.ok) throw new Error(res.error || `${label} failed`);
      setNote(res.note ?? label);
      await refreshList();
      if (res.app) selectApp(res.app.id);
      else if (selectedId) await refreshSelected(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onEditSpec = async () => {
    if (!selected) return;
    setBusy(true);
    setError(undefined);
    setNote(undefined);
    try {
      const res = await thawApp(settings, selected.id);
      if (!res.ok) throw new Error(res.error || "Thaw failed");
      const yaml = res.yaml?.trim();
      if (!yaml) throw new Error("Thaw returned no YAML");

      const existing = draftForApp(selected.id);
      const draft = existing
        ? updateDraft(existing.id, {
            yaml,
            goal: selected.goal,
            status: "draft",
            specHash: selected.specHash,
            installedAppId: selected.id,
            scheduleEnabled: false,
            evidenceApproved: false,
            frozenId: undefined,
          })
        : upsertDraft({
            intent: selected.goal,
            goal: selected.goal,
            yaml,
            status: "draft",
            specHash: selected.specHash,
            installedAppId: selected.id,
            scheduleEnabled: false,
            evidenceApproved: false,
          });
      if (!draft) throw new Error("Could not open draft on this Desk");
      setNote(res.note ?? "Thawed — re-gates on Build");
      await refreshList();
      onNavigate({
        kind: "build-workspace",
        draftId: draft.id,
        view: "design",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const hitlRuns = runs.filter((r) => {
    const s = r.status.toLowerCase();
    return s === "waiting_you" || s.includes("wait") || s.includes("hitl");
  });

  return (
    <div class="desk-body apps-surface">
      <div class="console-head">
        <h1 class="console-title">Apps</h1>
        <p class="console-sub">
          Approved fleet · connect, enable, pause · Edit spec opens Build
        </p>
      </div>

      <div class="spec-grid">
        <section class="tile">
          <div class="tile-stack">
            <p class="tile-label">Install</p>
            <p class="tile-meta">
              Paste a Relay App JSON from Ship export.
            </p>
            <textarea
              class="spec-yaml"
              rows={8}
              value={installJson}
              placeholder='{ "kind": "relay.app.bundle", ... }'
              disabled={busy}
              onInput={(e) =>
                setInstallJson((e.target as HTMLTextAreaElement).value)
              }
            />
            <div class="cta-row">
              <button
                type="button"
                class="cta"
                disabled={busy || !installJson.trim()}
                onClick={() =>
                  void run("Installed", () =>
                    installAppJson(settings, installJson)
                  )
                }
              >
                Install
              </button>
              <button
                type="button"
                class="cta ghost"
                disabled={busy}
                onClick={() => void refreshList()}
              >
                Refresh
              </button>
            </div>
          </div>
        </section>

        <section class="tile">
          <div class="tile-stack">
            <p class="tile-label">Installed</p>
            {!apps.length ? (
              <p class="tile-meta">No apps yet — Ship enable lands them here.</p>
            ) : (
              <ul class="apps-list">
                {apps.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      class="apps-list-item"
                      data-active={selectedId === a.id ? "1" : "0"}
                      onClick={() => selectApp(a.id)}
                    >
                      <span class="tile-meta mono">
                        {schedulePhrase(a.scheduleState)}
                        {a.needsShadowGate ? " · needs gate" : ""}
                        {a.editing ? " · editing" : ""}
                      </span>
                      <span class="tile-title apps-list-goal">{a.goal}</span>
                      <span class="tile-meta mono">
                        {a.connectionsConnected}/{a.connectionsRequired} conn ·{" "}
                        {a.id.slice(0, 18)}…
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section class="tile spec-tile-wide">
          <div class="tile-stack">
            <p class="tile-label">Manage</p>
            {!selected ? (
              <p class="tile-meta">Select an installed app.</p>
            ) : (
              <>
                <h2 class="tile-title">{selected.goal}</h2>
                <p class="tile-meta mono">
                  {schedulePhrase(selected.scheduleState)} · hash{" "}
                  {selected.specHash.slice(0, 12)}…
                  {selected.needsShadowGate
                    ? " · finish Ship gate before Enable"
                    : ""}
                  {selected.editing ? " · thawed on Build" : ""}
                </p>

                <p class="tile-label">Connections</p>
                <div class="cta-row">
                  {required.length ? (
                    required.map((ref) => (
                      <button
                        key={ref}
                        type="button"
                        class="cta ghost"
                        disabled={busy || selected.editing}
                        onClick={() =>
                          void run(`Connect ${ref}`, () =>
                            connectApp(
                              settings,
                              selected.id,
                              ref,
                              !connections[ref]?.connected
                            )
                          )
                        }
                      >
                        {connections[ref]?.connected ? "✓ " : ""}
                        {ref}
                      </button>
                    ))
                  ) : (
                    <p class="tile-meta">No connections required.</p>
                  )}
                </div>

                <p class="tile-label">Schedule</p>
                <div class="cta-row">
                  <button
                    type="button"
                    class="cta"
                    disabled={
                      busy ||
                      selected.editing ||
                      selected.needsShadowGate ||
                      selected.scheduleState === "enabled"
                    }
                    title={
                      selected.needsShadowGate
                        ? "Approve shadow evidence on Build Ship first"
                        : undefined
                    }
                    onClick={() =>
                      void run("Enable", () => enableApp(settings, selected.id))
                    }
                  >
                    Enable
                  </button>
                  <button
                    type="button"
                    class="cta ghost"
                    disabled={busy || selected.scheduleState !== "enabled"}
                    onClick={() =>
                      void run("Pause", () => pauseApp(settings, selected.id))
                    }
                  >
                    Pause
                  </button>
                  <button
                    type="button"
                    class="cta ghost"
                    disabled={busy || selected.scheduleState !== "paused"}
                    onClick={() =>
                      void run("Resume", () => resumeApp(settings, selected.id))
                    }
                  >
                    Resume
                  </button>
                  <button
                    type="button"
                    class="cta ghost"
                    disabled={busy || selected.scheduleState === "disabled"}
                    onClick={() =>
                      void run("Disable", () =>
                        disableApp(settings, selected.id)
                      )
                    }
                  >
                    Disable
                  </button>
                </div>

                <div class="cta-row">
                  <button
                    type="button"
                    class="cta"
                    disabled={busy}
                    onClick={() => void onEditSpec()}
                  >
                    Edit spec
                  </button>
                  <button
                    type="button"
                    class="cta danger"
                    disabled={busy}
                    onClick={() =>
                      void run("Uninstall", async () => {
                        const res = await uninstallApp(settings, selected.id);
                        if (res.ok) {
                          selectApp(undefined);
                          setRuns([]);
                        }
                        return res;
                      })
                    }
                  >
                    Uninstall
                  </button>
                </div>
                <p class="tile-meta">
                  Edit spec thaws the app and opens Build Design — re-run checks
                  and Ship before Enable.
                </p>

                <p class="tile-label">Runs</p>
                {hitlRuns.length ? (
                  <div class="cta-row">
                    <p class="tile-meta">
                      {hitlRuns.length} waiting for you —
                    </p>
                    <button
                      type="button"
                      class="cta"
                      onClick={() => onNavigate({ kind: "seats" })}
                    >
                      Open Seats
                    </button>
                  </div>
                ) : null}
                {!runs.length ? (
                  <p class="tile-meta">No runs for this Spec hash yet.</p>
                ) : (
                  <ul class="apps-runs">
                    {runs.map((r) => (
                      <li key={r.runId} class="tile-meta mono">
                        {summarizeRunStatus(r.status)} · {r.mode} ·{" "}
                        {r.runId.slice(0, 14)}…
                        {r.evidenceApproved ? " · evidence✓" : ""}
                        {r.outcomeFollowUpCount
                          ? ` · outcomes ${r.outcomeCompleteCount ?? 0}/${r.outcomeFollowUpCount}`
                          : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </section>
      </div>

      {note ? <p class="tile-meta">{note}</p> : null}
      {error ? <p class="error spec-error">{error}</p> : null}
    </div>
  );
}
