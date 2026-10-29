import { useCallback, useEffect, useState } from "preact/hooks";
import type { DeskSettings } from "../gateway/types.ts";
import {
  evalSpec,
  fetchScaffoldProvider,
  freezeSpec,
  lowerSpec,
  runSpec,
  scaffoldSpec,
  validateSpec,
} from "./client.ts";
import {
  deriveSpecPipeline,
  gateSpecAction,
  scrollToSpecStep,
} from "./pipeline.ts";
import {
  DEFAULT_CE_INTENT,
  type EvalsResponse,
  type LowerResponse,
  type RunResponse,
  type SpecValidationResult,
} from "./types.ts";

type Props = {
  settings: DeskSettings;
};

function condenseError(message: string, max = 96): string {
  const one = message.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max - 1)}…`;
}

/**
 * Spec governance surface — Intent → scaffold → validate → evals → lower → freeze → run.
 * HITL cards stay on Console.
 */
export function SpecSurface({ settings }: Props) {
  const [intent, setIntent] = useState(DEFAULT_CE_INTENT);
  const [yaml, setYaml] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | undefined>();
  const [busyStartedAt, setBusyStartedAt] = useState<number | undefined>();
  const [busyElapsedSec, setBusyElapsedSec] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const [llmProvider, setLlmProvider] = useState<string | undefined>();
  const [mode, setMode] = useState<string | undefined>();
  const [validation, setValidation] = useState<SpecValidationResult | undefined>();
  const [evals, setEvals] = useState<EvalsResponse | undefined>();
  const [lowered, setLowered] = useState<LowerResponse | undefined>();
  const [manifestExpanded, setManifestExpanded] = useState(false);
  const [frozenId, setFrozenId] = useState<string | undefined>();
  const [runResult, setRunResult] = useState<RunResponse | undefined>();
  /** Bypass evals gate for Lower / Freeze / Run (explicit). */
  const [forcePipeline, setForcePipeline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchScaffoldProvider(settings).then((p) => {
      if (!cancelled) setLlmProvider(p);
    });
    return () => {
      cancelled = true;
    };
  }, [settings]);

  useEffect(() => {
    if (!busy) {
      setBusyStartedAt(undefined);
      setBusyElapsedSec(0);
      return;
    }
    const started = Date.now();
    setBusyStartedAt(started);
    setBusyElapsedSec(0);
    const id = window.setInterval(() => {
      setBusyElapsedSec(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [busy]);

  const rules = (() => {
    try {
      if (!yaml.trim()) return [];
      // Rules shown from last scaffold body via validation path — parse lightly from YAML text
      return extractRulesFromYaml(yaml);
    } catch {
      return [];
    }
  })();

  const pipeline = deriveSpecPipeline({
    intent,
    yaml,
    validation,
    evals,
    lowered,
    frozenId,
    runResult,
  });

  const gateInput = {
    intent,
    yaml,
    validation,
    evals,
    lowered,
    frozenId,
    runResult,
    busy,
    force: forcePipeline,
  };
  const scaffoldGate = gateSpecAction("scaffold", gateInput);
  const validateGate = gateSpecAction("validate", gateInput);
  const evalsGate = gateSpecAction("evals", gateInput);
  const lowerGate = gateSpecAction("lower", gateInput);
  const freezeGate = gateSpecAction("freeze", gateInput);
  const runGate = gateSpecAction("run", gateInput);
  const evalsPassed =
    evals?.ok === true || evals?.report?.passed === true;
  const yamlGateHint =
    [validateGate, evalsGate, lowerGate]
      .map((g) => g.reason)
      .find((r) => r && r.startsWith("blocked"));
  const freezeGateHint =
    [freezeGate, runGate].map((g) => g.reason).find(Boolean) ??
    (forcePipeline && !evalsPassed ? "force · evals not passed" : undefined);

  const onScaffold = useCallback(async () => {
    setBusy(true);
    setBusyLabel("Scaffolding… often 30–90s");
    setError(undefined);
    setRunResult(undefined);
    setFrozenId(undefined);
    try {
      const provider = await fetchScaffoldProvider(settings);
      setBusyLabel(`Scaffolding with ${provider}… often 30–90s`);
      // Prefer live LLM on the shell when a key is present; shell falls back to stub.
      const res = await scaffoldSpec(settings, intent);
      if (res.yaml) setYaml(res.yaml);
      setMode(res.mode);
      setEvals(undefined);
      setLowered(undefined);
      setForcePipeline(false);
      setManifestExpanded(false);
      if (res.validation) {
        setValidation(res.validation);
      } else if (res.errors?.length) {
        setValidation({
          ok: false,
          errors: res.errors,
          warnings: [],
        });
      }
      if (!res.ok || !res.yaml) {
        const detail =
          res.note ||
          res.errors
            ?.slice(0, 4)
            .map((e) => e.message)
            .join(" · ") ||
          res.error ||
          "Scaffold failed";
        throw new Error(
          res.yaml ? `Scaffold needs edits — ${detail}` : detail
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setBusyLabel(undefined);
    }
  }, [intent, settings]);

  const onValidate = useCallback(async () => {
    if (!yaml.trim()) return;
    setBusy(true);
    setBusyLabel("Validating…");
    setError(undefined);
    try {
      const res = await validateSpec(settings, yaml);
      setValidation(res.validation);
      if (res.yaml) setYaml(res.yaml);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setBusyLabel(undefined);
    }
  }, [settings, yaml]);

  const onEvals = useCallback(async () => {
    if (!yaml.trim()) return;
    setBusy(true);
    setBusyLabel("Running evals…");
    setError(undefined);
    try {
      const res = await evalSpec(settings, yaml);
      setEvals(res);
      if (!res.ok) {
        setError(
          res.report?.errors?.join("; ") ||
            res.error ||
            "Evals failed — fix rules or fixtures before freeze/run"
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setBusyLabel(undefined);
    }
  }, [settings, yaml]);

  const onLower = useCallback(async () => {
    if (!yaml.trim()) return;
    setBusy(true);
    setBusyLabel("Lowering…");
    setError(undefined);
    try {
      const res = await lowerSpec(settings, yaml);
      setLowered(res);
      if (!res.ok) {
        setValidation(res.validation);
        setManifestExpanded(false);
        throw new Error(res.error || "Lower failed");
      }
      setManifestExpanded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setBusyLabel(undefined);
    }
  }, [settings, yaml]);

  const onFreeze = useCallback(async () => {
    if (!yaml.trim()) return;
    setBusy(true);
    setBusyLabel("Freezing…");
    setError(undefined);
    try {
      const res = await freezeSpec(settings, yaml);
      if (!res.ok) {
        setValidation(res.validation);
        throw new Error(res.error || "Freeze failed");
      }
      setFrozenId(res.spec?.id);
      if (res.yaml) setYaml(res.yaml);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setBusyLabel(undefined);
    }
  }, [settings, yaml]);

  const onRun = useCallback(async () => {
    if (!yaml.trim()) return;
    setBusy(true);
    setBusyLabel("Running (dry-run)…");
    setError(undefined);
    try {
      const res = await runSpec(settings, yaml, { autoApprove: true });
      setRunResult(res);
      if (!res.ok) {
        setValidation(res.validation);
        throw new Error(res.error || `Run ended ${res.state ?? "failed"}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setBusyLabel(undefined);
    }
  }, [settings, yaml]);

  return (
    <div class="desk-body spec-surface">
      <div class="console-head">
        <h1 class="console-title">Spec</h1>
        <p class="console-sub">
          Intent → dry-run · HITL stays in Console
        </p>
        <nav class="spec-pipeline" aria-label="Spec pipeline">
          <ol class="spec-pipeline-list">
            {pipeline.map((step, i) => (
              <li
                key={step.id}
                class="spec-pipeline-item"
                data-status={step.status}
              >
                {i > 0 ? (
                  <span class="spec-pipeline-sep" aria-hidden="true">
                    →
                  </span>
                ) : null}
                <button
                  type="button"
                  class="spec-pipeline-step"
                  data-status={step.status}
                  disabled={step.status === "blocked"}
                  aria-current={
                    step.status === "current" || step.status === "error"
                      ? "step"
                      : undefined
                  }
                  title={
                    step.status === "blocked"
                      ? "Complete earlier steps first"
                      : `Go to ${step.label}`
                  }
                  onClick={() => scrollToSpecStep(step.target)}
                >
                  {step.label}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div
          class="spec-status-rail"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span class="spec-status-chip mono">
            llm · {llmProvider ?? "…"}
            {mode ? ` · mode ${mode}` : ""}
          </span>
          {busy ? (
            <span class="spec-status-chip mono" data-tone="busy">
              {busyLabel ?? "Working…"}
              {busyStartedAt != null ? ` · ${busyElapsedSec}s` : ""}
            </span>
          ) : (
            <span class="spec-status-chip mono" data-tone="idle">
              idle
            </span>
          )}
          {error ? (
            <span
              class="spec-status-chip mono"
              data-tone="error"
              title={error}
            >
              err · {condenseError(error)}
            </span>
          ) : null}
          {forcePipeline && !evalsPassed ? (
            <span class="spec-status-chip mono" data-tone="warn">
              force on
            </span>
          ) : null}
        </div>
      </div>

      <div class="spec-grid">
        <section class="tile" data-spec-step="intent">
          <div class="tile-stack">
            <p class="tile-label">Intent</p>
            <textarea
              class="spec-textarea"
              rows={8}
              value={intent}
              onInput={(e) => setIntent((e.target as HTMLTextAreaElement).value)}
              spellcheck={false}
            />
            <div class="cta-row">
              <button
                type="button"
                class="cta"
                disabled={!scaffoldGate.enabled}
                onClick={() => void onScaffold()}
              >
                {busy && busyLabel?.startsWith("Scaffold")
                  ? "Scaffolding…"
                  : "Scaffold"}
              </button>
              {busy && busyLabel ? (
                <span class="hint mono" aria-live="polite">
                  {busyLabel}
                </span>
              ) : mode ? (
                <span class="hint mono">mode · {mode}</span>
              ) : scaffoldGate.reason ? (
                <span class="hint mono">{scaffoldGate.reason}</span>
              ) : null}
            </div>
          </div>
        </section>

        <section class="tile" data-spec-step="yaml">
          <div class="tile-stack">
            <p class="tile-label">Spec YAML</p>
            <textarea
              class="spec-textarea mono"
              rows={14}
              value={yaml}
              placeholder="Scaffold an Intent to populate YAML"
              onInput={(e) => setYaml((e.target as HTMLTextAreaElement).value)}
              spellcheck={false}
            />
            <div class="cta-row">
              <button
                type="button"
                class="cta ghost"
                disabled={!validateGate.enabled}
                title={validateGate.reason}
                onClick={() => void onValidate()}
              >
                Validate
              </button>
              <button
                type="button"
                class="cta ghost"
                disabled={!evalsGate.enabled}
                title={evalsGate.reason}
                onClick={() => void onEvals()}
              >
                Evals
              </button>
              <button
                type="button"
                class="cta ghost"
                disabled={!lowerGate.enabled}
                title={lowerGate.reason}
                onClick={() => void onLower()}
              >
                Lower
              </button>
              {!evalsPassed ? (
                <button
                  type="button"
                  class="cta linkish"
                  disabled={busy || !yaml.trim()}
                  aria-pressed={forcePipeline}
                  onClick={() => setForcePipeline((v) => !v)}
                >
                  {forcePipeline ? "Force on" : "Force"}
                </button>
              ) : null}
            </div>
            {yamlGateHint || (forcePipeline && !evalsPassed) ? (
              <p class="tile-meta mono spec-gate-hint">
                {forcePipeline && !evalsPassed
                  ? "force · lower / freeze / run unlocked"
                  : yamlGateHint}
              </p>
            ) : null}
          </div>
        </section>

        <section class="tile" data-spec-step="validate">
          <div class="tile-stack">
            <p class="tile-label">Validator</p>
            {validation ? (
              <div class="tile-copy">
                <h2 class="tile-title">
                  {validation.ok ? "Valid" : "Errors"}
                </h2>
                <p class="tile-meta mono">
                  {validation.errors.length} errors ·{" "}
                  {validation.warnings?.length ?? 0} warnings
                  {validation.durationMs != null
                    ? ` · ${validation.durationMs.toFixed(1)}ms`
                    : ""}
                </p>
                {validation.errors.slice(0, 8).map((e) => (
                  <p class="tile-meta error" key={`${e.code}-${e.message}`}>
                    [{e.code}] {e.message}
                  </p>
                ))}
              </div>
            ) : (
              <div class="tile-copy">
                <h2 class="tile-title">No result yet</h2>
                <p class="tile-meta">Scaffold or Validate to see checks</p>
              </div>
            )}
          </div>
        </section>

        <section class="tile" data-spec-step="evals">
          <div class="tile-stack">
            <p class="tile-label">Rules / evals</p>
            {rules.length ? (
              <ul class="spec-rule-list">
                {rules.map((r) => (
                  <li key={r.id}>
                    <span class="mono">{r.id}</span>
                    <span class="muted"> · {r.kind}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p class="tile-meta">Rules appear after scaffold</p>
            )}
            {evals?.report ? (
              <div class="tile-copy">
                <p class="tile-meta mono">
                  evals · {evals.report.passed ? "pass" : "fail"}
                  {evals.report.cases.length
                    ? ` · ${evals.report.cases.length} case(s)`
                    : ""}
                </p>
                {evals.report.cases.length ? (
                  <ul class="spec-rule-list">
                    {evals.report.cases.map((c) => (
                      <li key={c.caseId}>
                        <span class="mono">{c.caseId}</span>
                        <span class="muted">
                          {" "}
                          · {c.passed ? "pass" : "fail"}
                          {!c.passed && c.results?.length
                            ? ` · ${c.results
                                .filter((r) => !r.ok)
                                .map(
                                  (r) =>
                                    `${r.ruleId} got=${r.passed} want=${
                                      r.expected ?? "pass"
                                    }`
                                )
                                .join("; ")}`
                            : ""}
                          {c.error ? ` · ${c.error}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {!evals.report.passed && evals.report.errors?.length ? (
                  <p class="tile-meta error mono">
                    {evals.report.errors.slice(0, 3).join(" · ")}
                  </p>
                ) : null}
              </div>
            ) : null}
            {evals?.compiled?.uncovered?.length ? (
              <p class="tile-meta warn">
                uncovered · {evals.compiled.uncovered.join(", ")}
              </p>
            ) : null}
          </div>
        </section>

        <section
          class={`tile${manifestExpanded && lowered?.ok ? " spec-tile-wide" : ""}`}
          data-spec-step="lower"
        >
          <div class="tile-stack">
            <div class="tile-head">
              <p class="tile-label">Manifest</p>
              {lowered?.ok ? (
                <button
                  type="button"
                  class="cta linkish"
                  onClick={() => setManifestExpanded((v) => !v)}
                >
                  {manifestExpanded ? "Collapse" : "Expand full"}
                </button>
              ) : null}
            </div>
            {lowered?.ok ? (
              <div class="tile-copy">
                <h2 class="tile-title">
                  {String(lowered.manifest?.name ?? "workflow")}
                </h2>
                <p class="tile-meta mono">
                  hash · {lowered.specHash}
                </p>
                <p class="tile-meta mono">
                  stages ·{" "}
                  {(lowered.manifest?.stages as unknown[] | undefined)
                    ?.map((s) =>
                      typeof s === "object" && s && "name" in s
                        ? (s as { name: string }).name
                        : String(s)
                    )
                    .join(" → ") ?? "—"}
                  {" · "}
                  engines ·{" "}
                  {Array.isArray(lowered.manifest?.engines_required)
                    ? (lowered.manifest.engines_required as string[]).join(", ")
                    : "—"}
                </p>
                <pre
                  class={`spec-pre${manifestExpanded ? " spec-pre-expanded" : ""}`}
                >
                  {JSON.stringify(
                    manifestExpanded
                      ? {
                          specHash: lowered.specHash,
                          manifest: lowered.manifest,
                          relay: lowered.relay,
                        }
                      : {
                          stages: (
                            lowered.manifest?.stages as unknown[] | undefined
                          )?.map((s) =>
                            typeof s === "object" && s && "name" in s
                              ? (s as { name: string }).name
                              : s
                          ),
                          engines: lowered.manifest?.engines_required,
                        },
                    null,
                    2
                  )}
                </pre>
              </div>
            ) : (
              <div class="tile-copy">
                <h2 class="tile-title">Not lowered</h2>
                <p class="tile-meta">Lower produces the runnable manifest</p>
              </div>
            )}
          </div>
        </section>

        <section class="tile" data-spec-step="freeze">
          <div class="tile-stack">
            <p class="tile-label">Freeze / run</p>
            <div class="cta-row">
              <button
                type="button"
                class="cta"
                disabled={!freezeGate.enabled}
                title={freezeGate.reason}
                onClick={() => void onFreeze()}
              >
                Freeze
              </button>
              <button
                type="button"
                class="cta"
                disabled={!runGate.enabled}
                title={runGate.reason}
                onClick={() => void onRun()}
              >
                Run dry
              </button>
              {!evalsPassed ? (
                <button
                  type="button"
                  class="cta linkish"
                  disabled={busy || !yaml.trim()}
                  aria-pressed={forcePipeline}
                  onClick={() => setForcePipeline((v) => !v)}
                >
                  {forcePipeline ? "Force on" : "Force"}
                </button>
              ) : null}
            </div>
            {freezeGateHint ? (
              <p class="tile-meta mono spec-gate-hint">{freezeGateHint}</p>
            ) : null}
            {frozenId ? (
              <p class="tile-meta mono">frozen · {frozenId}</p>
            ) : null}
            {runResult ? (
              <div class="tile-copy">
                <h2 class="tile-title">
                  {runResult.state ?? (runResult.ok ? "COMPLETE" : "FAILED")}
                </h2>
                <p class="tile-meta mono">
                  evidence · {runResult.evidenceCount ?? 0}
                  {runResult.specHash
                    ? ` · ${runResult.specHash.slice(0, 12)}…`
                    : ""}
                </p>
                {runResult.note ? (
                  <p class="tile-meta">{runResult.note}</p>
                ) : null}
                {runResult.stepOutputs &&
                Object.keys(runResult.stepOutputs).length ? (
                  <pre class="spec-pre spec-pre-expanded">
                    {JSON.stringify(runResult.stepOutputs, null, 2)}
                  </pre>
                ) : null}
                {runResult.evidence?.length ? (
                  <pre class="spec-pre">
                    {JSON.stringify(
                      runResult.evidence.map((e) => ({
                        step: e.stepId,
                        kind: e.kind,
                        detail: e.detail,
                      })),
                      null,
                      2
                    )}
                  </pre>
                ) : null}
              </div>
            ) : (
              <p class="tile-meta">
                Dry-run auto-approves HITL and shows step outputs here. Live
                negotiate cards stay on Console.
              </p>
            )}
          </div>
        </section>
      </div>

      {error ? <p class="error spec-error">{error}</p> : null}
    </div>
  );
}

function extractRulesFromYaml(yaml: string): Array<{ id: string; kind: string }> {
  const rules: Array<{ id: string; kind: string }> = [];
  const lines = yaml.split("\n");
  let inRules = false;
  let current: { id?: string; kind?: string } = {};
  for (const line of lines) {
    if (/^rules:\s*$/.test(line)) {
      inRules = true;
      continue;
    }
    if (inRules && /^[a-zA-Z]/.test(line) && !line.startsWith(" ")) {
      break;
    }
    if (!inRules) continue;
    const id = /^\s+-\s+id:\s*["']?([^"'\s]+)/.exec(line);
    if (id) {
      if (current.id && current.kind) {
        rules.push({ id: current.id, kind: current.kind });
      }
      current = { id: id[1] };
      continue;
    }
    const kind = /^\s+kind:\s*["']?([^"'\s]+)/.exec(line);
    if (kind && current.id) {
      current.kind = kind[1];
    }
  }
  if (current.id && current.kind) {
    rules.push({ id: current.id, kind: current.kind });
  }
  return rules;
}
