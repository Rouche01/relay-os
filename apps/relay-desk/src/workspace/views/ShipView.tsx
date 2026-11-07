import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { DeskSettings } from "../../gateway/types.ts";
import type { DraftRecord } from "../../specs/draft-store.ts";
import { createDraftShipAdapter } from "../ship/draft-adapter.ts";
import type { ShipAction, ShipChecklist } from "../ship/types.ts";

export type ShipViewProps = {
  draft: DraftRecord;
  settings: DeskSettings;
  onDraftUpdated: (draft: DraftRecord) => void;
  /** After enable — open Apps fleet. */
  onEnabled?: () => void;
};

function actionForStep(
  stepId: string | undefined
): ShipAction | undefined {
  switch (stepId) {
    case "frozen":
      return "freeze";
    case "installed":
      return "install";
    case "shadow":
      return "shadow";
    case "approved":
      return "approve";
    case "enabled":
      return "enable";
    default:
      return undefined;
  }
}

export function ShipView({
  draft,
  settings,
  onDraftUpdated,
  onEnabled,
}: ShipViewProps) {
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const adapter = useMemo(
    () =>
      createDraftShipAdapter({
        settings,
        getDraft: () => draftRef.current,
        onDraftUpdated,
      }),
    [settings, onDraftUpdated]
  );

  const [checklist, setChecklist] = useState<ShipChecklist | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [note, setNote] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    const next = await adapter.refresh();
    setChecklist(next);
  }, [adapter]);

  useEffect(() => {
    void refresh().catch((err) =>
      setError(err instanceof Error ? err.message : String(err))
    );
  }, [refresh, draft.id, draft.status, draft.installedAppId, draft.evidenceApproved, draft.scheduleEnabled]);

  const runAction = useCallback(
    async (action: ShipAction, connection?: string) => {
      setBusy(true);
      setError(undefined);
      try {
        const res = await adapter.run(action, { connection });
        setChecklist(res.checklist);
        setNote(res.note);
        if (action === "enable") onEnabled?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        try {
          setChecklist(await adapter.refresh());
        } catch {
          /* ignore */
        }
      } finally {
        setBusy(false);
      }
    },
    [adapter, onEnabled]
  );

  const nextAction = actionForStep(checklist?.nextStepId);
  const evidence = checklist?.evidence;
  const writes = evidence?.simulatedWrites ?? [];

  return (
    <div class="ship-view">
      <section class="tile ship-summary">
        <div class="tile-stack">
          <div class="tile-head">
            <p class="tile-label">Going live</p>
            {nextAction ? (
              <button
                type="button"
                class="cta"
                disabled={busy}
                onClick={() => void runAction(nextAction)}
              >
                {busy
                  ? "Working…"
                  : checklist?.steps.find((s) => s.id === checklist.nextStepId)
                      ?.actionLabel ?? "Continue"}
              </button>
            ) : checklist?.steps.every((s) => s.done) ? (
              <span class="tile-meta mono">Live path ready</span>
            ) : null}
          </div>
          <h2 class="tile-title">
            {checklist?.steps.every((s) => s.done)
              ? "Enabled"
              : "Ship checklist"}
          </h2>
          <p class="tile-meta">
            Freeze → install → connect → shadow → approve → enable. Enable stays
            locked until shadow evidence is approved.
          </p>
          {note ? <p class="tile-meta mono">{note}</p> : null}
          {error ? <p class="error">{error}</p> : null}
        </div>
      </section>

      <section class="tile">
        <div class="tile-stack">
          <p class="tile-label">Checklist</p>
          <ol class="ship-checklist">
            {(checklist?.steps ?? []).map((step) => (
              <li
                key={step.id}
                class="ship-check-item"
                data-done={step.done ? "1" : "0"}
                data-next={checklist?.nextStepId === step.id ? "1" : "0"}
              >
                <span class="ship-check-mark mono" aria-hidden="true">
                  {step.done ? "✓" : "·"}
                </span>
                <div class="ship-check-copy">
                  <span class="ship-check-label">{step.label}</span>
                  {step.detail ? (
                    <span class="tile-meta mono">{step.detail}</span>
                  ) : null}
                </div>
                {step.id === "connected" &&
                (checklist?.connections?.length ?? 0) > 0 ? (
                  <div class="ship-conn-row">
                    {checklist!.connections!.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        class="cta ghost"
                        disabled={busy || !draft.installedAppId}
                        title="Mark ready for Ship (tokens stay on Spec API env)"
                        onClick={() => void runAction("connect", c.id)}
                      >
                        {c.connected ? "✓ ready · " : "mark · "}
                        {c.id}
                      </button>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section class="tile">
        <div class="tile-stack">
          <p class="tile-label">Shadow evidence</p>
          {!evidence?.runId ? (
            <p class="tile-meta">Run a shadow pass to review simulated writes.</p>
          ) : (
            <>
              <p class="tile-meta mono">
                run · {evidence.runId}
                {evidence.evidenceCount != null
                  ? ` · evidence ${evidence.evidenceCount}`
                  : ""}
                {evidence.simulatedWriteCount != null
                  ? ` · simulated ${evidence.simulatedWriteCount}`
                  : ""}
                {evidence.approved ? " · approved" : " · awaiting approval"}
              </p>
              {writes.length ? (
                <div class="spec-diag-scroll">
                  <table class="spec-diag-table">
                    <thead>
                      <tr>
                        <th scope="col">Step</th>
                        <th scope="col">Simulated write</th>
                      </tr>
                    </thead>
                    <tbody>
                      {writes.map((w, i) => (
                        <tr key={`${w.stepId ?? "w"}-${i}`}>
                          <td class="mono">{w.stepId ?? "—"}</td>
                          <td>
                            <pre class="spec-pre sch-pre">
                              {JSON.stringify(w.detail ?? w, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p class="tile-meta">
                  No simulated writes recorded on this run
                  {evidence.note ? ` · ${evidence.note}` : ""}.
                </p>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
