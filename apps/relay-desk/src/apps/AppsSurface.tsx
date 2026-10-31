import { useCallback, useEffect, useState } from "preact/hooks";
import type { DeskSettings } from "../gateway/types.ts";
import {
  approveAppEvidence,
  connectApp,
  disableApp,
  enableApp,
  getApp,
  installAppJson,
  listAppRuns,
  listApps,
  pauseApp,
  refreezeApp,
  resumeApp,
  shadowRunApp,
  thawApp,
  uninstallApp,
} from "./client.ts";
import type { AppRunSummary, InstalledAppSummary } from "./types.ts";

type Props = {
  settings: DeskSettings;
};

export function AppsSurface({ settings }: Props) {
  const [apps, setApps] = useState<InstalledAppSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [installJson, setInstallJson] = useState("");
  const [editYaml, setEditYaml] = useState("");
  const [connections, setConnections] = useState<
    Record<string, { connected: boolean }>
  >({});
  const [required, setRequired] = useState<string[]>([]);
  const [runs, setRuns] = useState<AppRunSummary[]>([]);
  const [note, setNote] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

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
      if (res.yaml) setEditYaml(res.yaml);
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
  }, [selectedId, refreshSelected]);

  const selected = apps.find((a) => a.id === selectedId);

  const run = async (label: string, fn: () => Promise<{ ok: boolean; error?: string; note?: string; app?: InstalledAppSummary }>) => {
    setBusy(true);
    setError(undefined);
    setNote(undefined);
    try {
      const res = await fn();
      if (!res.ok) throw new Error(res.error || `${label} failed`);
      setNote(res.note ?? label);
      await refreshList();
      if (res.app) setSelectedId(res.app.id);
      else if (selectedId) await refreshSelected(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="desk-body apps-surface">
      <div class="console-head">
        <h1 class="console-title">Apps</h1>
        <p class="console-sub">
          Approved apps · enable, pause, runs · Edit spec returns to Build
        </p>
      </div>

      <div class="spec-grid">
        <section class="tile">
          <div class="tile-stack">
            <p class="tile-label">Install</p>
            <p class="tile-meta">
              Paste a Relay App JSON from Spec export (
              <span class="mono">POST /api/v2/bundle/export</span>).
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
              <p class="tile-meta">No apps yet.</p>
            ) : (
              <ul class="apps-list">
                {apps.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      class="apps-list-item"
                      data-active={selectedId === a.id ? "1" : "0"}
                      onClick={() => setSelectedId(a.id)}
                    >
                      <span class="tile-meta mono">
                        {a.scheduleState}
                        {a.needsShadowGate ? " · gate" : ""}
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
            <p class="tile-label">Lifecycle</p>
            {!selected ? (
              <p class="tile-meta">Select an installed app.</p>
            ) : (
              <>
                <p class="tile-meta mono">
                  {selected.scheduleState} · hash {selected.specHash.slice(0, 12)}…
                  {selected.needsShadowGate ? " · needs shadow gate" : ""}
                  {selected.editing ? " · thawed" : ""}
                </p>
                <p class="tile-label">Connections</p>
                <div class="cta-row">
                  {required.length ? (
                    required.map((ref) => (
                      <button
                        key={ref}
                        type="button"
                        class="cta ghost"
                        disabled={busy}
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
                <div class="cta-row">
                  <button
                    type="button"
                    class="cta"
                    disabled={busy || selected.editing}
                    onClick={() =>
                      void run("Shadow run", () =>
                        shadowRunApp(settings, selected.id)
                      )
                    }
                  >
                    Shadow run
                  </button>
                  <button
                    type="button"
                    class="cta ghost"
                    disabled={busy || selected.editing}
                    onClick={() =>
                      void run("Approve evidence", () =>
                        approveAppEvidence(settings, selected.id)
                      )
                    }
                  >
                    Approve evidence
                  </button>
                  <button
                    type="button"
                    class="cta"
                    disabled={busy || selected.editing || selected.needsShadowGate}
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
                    class="cta ghost"
                    disabled={busy || selected.editing}
                    onClick={() =>
                      void run("Thaw", async () => {
                        const res = await thawApp(settings, selected.id);
                        if (res.ok && res.yaml) setEditYaml(res.yaml);
                        return res;
                      })
                    }
                  >
                    Thaw to edit
                  </button>
                  <button
                    type="button"
                    class="cta ghost"
                    disabled={busy || !selected.editing}
                    onClick={() =>
                      void run("Refreeze", () =>
                        refreezeApp(settings, selected.id, editYaml)
                      )
                    }
                  >
                    Refreeze
                  </button>
                  <button
                    type="button"
                    class="cta danger"
                    disabled={busy}
                    onClick={() =>
                      void run("Uninstall", async () => {
                        const res = await uninstallApp(settings, selected.id);
                        if (res.ok) {
                          setSelectedId(undefined);
                          setRuns([]);
                        }
                        return res;
                      })
                    }
                  >
                    Uninstall
                  </button>
                </div>
                {selected.editing ? (
                  <textarea
                    class="spec-yaml"
                    rows={12}
                    value={editYaml}
                    disabled={busy}
                    onInput={(e) =>
                      setEditYaml((e.target as HTMLTextAreaElement).value)
                    }
                  />
                ) : null}
                <p class="tile-label">Runs / outcomes</p>
                {!runs.length ? (
                  <p class="tile-meta">No runs for this Spec hash yet.</p>
                ) : (
                  <ul class="apps-runs">
                    {runs.map((r) => (
                      <li key={r.runId} class="tile-meta mono">
                        {r.runId.slice(0, 16)}… · {r.status} · {r.mode}
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
