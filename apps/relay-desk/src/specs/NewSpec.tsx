import { useCallback, useEffect, useState } from "preact/hooks";
import type { DeskSettings } from "../gateway/types.ts";
import { fetchScaffoldProvider, scaffoldSpec } from "../spec/client.ts";
import { scaffoldPhaseLabel } from "../spec/history.ts";
import {
  DEFAULT_CE_INTENT,
  INTENT_PRESETS,
  type IntentPresetId,
  type ScaffoldNeed,
} from "../spec/types.ts";
import type { DeskRoute } from "../workspace/routes.ts";
import { upsertDraft } from "./draft-store.ts";
import {
  needActionLabel,
  resolveScaffoldOutcome,
  type ScaffoldOutcome,
} from "./scaffold-outcome.ts";

export type NewSpecProps = {
  settings: DeskSettings;
  onNavigate: (route: DeskRoute) => void;
};

const OUTCOME_CHIPS: ReadonlyArray<{
  id: ScaffoldOutcome;
  label: string;
}> = [
  { id: "llm", label: "llm" },
  { id: "stub", label: "stub" },
  { id: "needs_edits", label: "needs edits" },
  { id: "needs", label: "needs catalog" },
];

export function NewSpec({ settings, onNavigate }: NewSpecProps) {
  const [intent, setIntent] = useState(DEFAULT_CE_INTENT);
  const [intentPreset, setIntentPreset] = useState<IntentPresetId | "custom">(
    "ce-fashion"
  );
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | undefined>();
  const [busyStartedAt, setBusyStartedAt] = useState<number | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [outcome, setOutcome] = useState<ScaffoldOutcome | undefined>();
  const [attempts, setAttempts] = useState<number | undefined>();
  const [note, setNote] = useState<string | undefined>();
  const [needs, setNeeds] = useState<ScaffoldNeed[] | undefined>();

  useEffect(() => {
    if (!busy) {
      setBusyStartedAt(undefined);
      return;
    }
    const started = Date.now();
    setBusyStartedAt(started);
    const id = window.setInterval(() => {
      const sec = Math.floor((Date.now() - started) / 1000);
      setBusyLabel((prev) => {
        if (!prev) return prev;
        const provider = prev.match(/with (\S+)/)?.[1];
        const phase = scaffoldPhaseLabel(sec);
        return provider
          ? `Scaffolding with ${provider} · ${phase}`
          : `Scaffolding · ${phase}`;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [busy]);

  const onCreate = useCallback(async () => {
    const trimmed = intent.trim();
    if (!trimmed) {
      setError("Write an intent first");
      return;
    }
    setBusy(true);
    setBusyLabel("Scaffolding… often 30–90s");
    setError(undefined);
    setNote(undefined);
    setNeeds(undefined);
    setOutcome(undefined);
    setAttempts(undefined);
    try {
      const provider = await fetchScaffoldProvider(settings);
      setBusyLabel(`Scaffolding with ${provider}… often 30–90s`);
      const res = await scaffoldSpec(settings, trimmed);
      setAttempts(res.attempts);
      setNeeds(res.needs);
      const nextOutcome = resolveScaffoldOutcome({
        ok: res.ok,
        mode: res.mode,
        yaml: res.yaml,
        needs: res.needs,
        validation: res.validation
          ? res.validation
          : res.errors?.length
            ? { ok: false, errors: res.errors, warnings: [] }
            : undefined,
      });
      setOutcome(nextOutcome);

      if (nextOutcome === "needs") {
        setNote(res.note ?? res.error);
        if (res.yaml?.trim()) {
          upsertDraft({
            intent: trimmed,
            yaml: res.yaml,
            status: "needs_catalog",
            mode: res.mode,
          });
        }
        return;
      }

      if (!res.yaml?.trim()) {
        throw new Error(
          res.note ||
            res.errors
              ?.slice(0, 4)
              .map((e) => e.message)
              .join(" · ") ||
            res.error ||
            "Scaffold returned no YAML"
        );
      }

      const draft = upsertDraft({
        intent: trimmed,
        yaml: res.yaml,
        status: "draft",
        mode: res.mode,
      });

      if (nextOutcome === "needs_edits") {
        setNote(res.note);
      }

      onNavigate({
        kind: "build-workspace",
        draftId: draft.id,
        view: "design",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setBusyLabel(undefined);
    }
  }, [intent, settings, onNavigate]);

  return (
    <div class="desk-body new-spec">
      <div class="console-head library-head">
        <div class="library-head-text">
          <button
            type="button"
            class="cta linkish ws-back"
            onClick={() => onNavigate({ kind: "build" })}
          >
            ← Build
          </button>
          <h1 class="console-title">New spec</h1>
          <p class="console-sub">Intent → draft · then Design</p>
        </div>
      </div>

      <div class="new-spec-layout">
        <section class="tile new-spec-main">
          <div class="tile-stack">
            <div class="tile-head">
              <p class="tile-label">Intent</p>
              <p class="tile-meta mono">presets set text only</p>
            </div>
            <div
              class="spec-intent-presets"
              role="group"
              aria-label="Intent presets"
            >
              {INTENT_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  class="spec-intent-preset"
                  data-active={intentPreset === p.id ? "1" : "0"}
                  disabled={busy}
                  onClick={() => {
                    setIntentPreset(p.id);
                    setIntent(p.intent);
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <textarea
              class="spec-textarea"
              rows={12}
              value={intent}
              disabled={busy}
              placeholder="What should the app do? Include hard limits (never…, ask before…)."
              onInput={(e) => {
                setIntentPreset("custom");
                setIntent((e.target as HTMLTextAreaElement).value);
              }}
              spellcheck={false}
            />
            <p class="tile-meta">
              Name hard limits in the intent — what must never happen, and what
              always needs you first.
            </p>
            <div class="cta-row">
              <button
                type="button"
                class="cta"
                disabled={busy || !intent.trim()}
                onClick={() => void onCreate()}
              >
                {busy
                  ? "Creating…"
                  : outcome
                    ? "Retry create draft"
                    : "Create draft"}
              </button>
              {busy ? (
                <span class="hint mono" aria-live="polite">
                  {busyLabel ?? "Scaffolding…"}
                  {busyStartedAt
                    ? ` · ${scaffoldPhaseLabel(
                        Math.floor((Date.now() - busyStartedAt) / 1000)
                      )}`
                    : ""}
                </span>
              ) : !intent.trim() ? (
                <span class="hint mono">blocked · intent empty</span>
              ) : null}
            </div>

            <div class="spec-scaffold-meta" aria-live="polite">
              <div class="spec-outcome-chips" role="list">
                {OUTCOME_CHIPS.map(({ id, label }) => (
                  <span
                    key={id}
                    role="listitem"
                    class="spec-outcome-chip"
                    data-active={outcome === id ? "1" : "0"}
                    data-tone={
                      id === "needs_edits" || id === "needs" ? "warn" : "neutral"
                    }
                  >
                    {label}
                  </span>
                ))}
              </div>
              {attempts != null ? (
                <span class="hint mono">attempts · {attempts}</span>
              ) : null}
              {note ? (
                <p class="tile-meta mono spec-scaffold-note">{note}</p>
              ) : null}
              {error ? <p class="error">{error}</p> : null}
              {needs?.length ? (
                <div class="spec-needs" role="region" aria-label="Capability gaps">
                  <p class="tile-label">Needs before this can draft</p>
                  <ul class="spec-needs-list">
                    {needs.map((n) => (
                      <li key={`${n.kind}:${n.id}`} class="spec-needs-item">
                        <span class="mono spec-needs-kind">{n.kind}</span>
                        <span class="mono spec-needs-id">{n.id}</span>
                        <span class="spec-needs-action">
                          {needActionLabel(n.action)}
                        </span>
                        <span class="tile-meta">{n.reason}</span>
                      </li>
                    ))}
                  </ul>
                  <p class="hint mono">
                    Import a descriptor or add the connection, then retry Create
                    draft.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <aside class="tile new-spec-rail" aria-label="What happens next">
          <div class="tile-stack">
            <p class="tile-label">After create</p>
            <ol class="new-spec-next">
              <li>
                <strong>Design</strong>
                <span class="tile-meta">See what it will do</span>
              </li>
              <li>
                <strong>Verify</strong>
                <span class="tile-meta">Run checks</span>
              </li>
              <li>
                <strong>Ship</strong>
                <span class="tile-meta">Freeze, shadow, enable</span>
              </li>
              <li>
                <strong>Apps</strong>
                <span class="tile-meta">Approved fleet lives there</span>
              </li>
            </ol>
            <p class="tile-meta">
              Paste YAML from the Build library. Install a bundle from Apps.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
