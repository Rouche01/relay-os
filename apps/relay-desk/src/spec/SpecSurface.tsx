import { useCallback, useEffect, useRef, useState } from "preact/hooks";
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
  lineDiff,
  loadSpecHistory,
  pushSpecHistory,
  scaffoldPhaseLabel,
  type SpecHistoryEntry,
} from "./history.ts";
import {
  deriveSpecPipeline,
  gateSpecAction,
  scrollToSpecStep,
} from "./pipeline.ts";
import {
  DEFAULT_CE_INTENT,
  INTENT_PRESETS,
  type EvalsResponse,
  type IntentPresetId,
  type LowerResponse,
  type RunResponse,
  type SpecValidationIssue,
  type SpecValidationResult,
} from "./types.ts";

type Props = {
  settings: DeskSettings;
  /** Switch Desk main tab to Console (HITL cards). */
  onOpenConsole?: () => void;
};

/** Chip after a scaffold attempt — distinct from raw API `mode`. */
type ScaffoldOutcome = "llm" | "stub" | "needs_edits";

function condenseError(message: string, max = 96): string {
  const one = message.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max - 1)}…`;
}

function resolveScaffoldOutcome(res: {
  ok: boolean;
  mode?: string;
  yaml?: string;
  validation?: SpecValidationResult;
}): ScaffoldOutcome | undefined {
  if (!res.yaml?.trim()) return undefined;
  if (!res.ok || res.validation?.ok === false) return "needs_edits";
  if (res.mode === "stub") return "stub";
  return "llm";
}

/** 0-based line index for a validator hint, or -1. */
function findYamlIssueLine(
  yaml: string,
  issue: Pick<SpecValidationIssue, "path" | "stepId" | "ruleId">
): number {
  const lines = yaml.split("\n");
  if (issue.stepId) {
    const needle = issue.stepId;
    for (let i = 0; i < lines.length; i++) {
      if (new RegExp(`^\\s+-\\s+id:\\s*["']?${escapeRegExp(needle)}\\b`).test(lines[i]!)) {
        return i;
      }
    }
  }
  if (issue.ruleId) {
    const needle = issue.ruleId;
    for (let i = 0; i < lines.length; i++) {
      if (new RegExp(`^\\s+-\\s+id:\\s*["']?${escapeRegExp(needle)}\\b`).test(lines[i]!)) {
        return i;
      }
    }
  }
  if (issue.path) {
    const leaf = issue.path.split("/").filter(Boolean).pop();
    if (leaf && !/^\d+$/.test(leaf)) {
      for (let i = 0; i < lines.length; i++) {
        if (new RegExp(`^\\s*${escapeRegExp(leaf)}\\s*:`).test(lines[i]!)) {
          return i;
        }
      }
    }
  }
  return -1;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function focusYamlLine(
  textarea: HTMLTextAreaElement | null,
  yaml: string,
  lineIndex: number
): void {
  if (!textarea || lineIndex < 0) return;
  const lines = yaml.split("\n");
  let start = 0;
  for (let i = 0; i < lineIndex; i++) {
    start += (lines[i]?.length ?? 0) + 1;
  }
  const end = start + (lines[lineIndex]?.length ?? 0);
  scrollToSpecStep("yaml");
  textarea.focus();
  textarea.setSelectionRange(start, end);
  const lineHeight =
    Number.parseFloat(getComputedStyle(textarea).lineHeight) || 18;
  textarea.scrollTop = Math.max(0, lineIndex * lineHeight - textarea.clientHeight / 3);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Spec governance surface — Intent → scaffold → validate → evals → lower → freeze → run.
 * HITL cards stay on Console.
 */
export function SpecSurface({ settings, onOpenConsole }: Props) {
  const [intent, setIntent] = useState(DEFAULT_CE_INTENT);
  const [intentPreset, setIntentPreset] = useState<IntentPresetId | "custom">(
    "ce-fashion"
  );
  const [yaml, setYaml] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | undefined>();
  const [busyStartedAt, setBusyStartedAt] = useState<number | undefined>();
  const [busyElapsedSec, setBusyElapsedSec] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const [llmProvider, setLlmProvider] = useState<string | undefined>();
  const [mode, setMode] = useState<string | undefined>();
  const [scaffoldOutcome, setScaffoldOutcome] = useState<
    ScaffoldOutcome | undefined
  >();
  const [scaffoldAttempts, setScaffoldAttempts] = useState<number | undefined>();
  const [scaffoldNote, setScaffoldNote] = useState<string | undefined>();
  const [validation, setValidation] = useState<SpecValidationResult | undefined>();
  const [evals, setEvals] = useState<EvalsResponse | undefined>();
  const [lowered, setLowered] = useState<LowerResponse | undefined>();
  const [manifestExpanded, setManifestExpanded] = useState(false);
  const [frozenId, setFrozenId] = useState<string | undefined>();
  const [runResult, setRunResult] = useState<RunResponse | undefined>();
  /** Bypass evals gate for Lower / Freeze / Run (explicit). */
  const [forcePipeline, setForcePipeline] = useState(false);
  const [runTab, setRunTab] = useState<"steps" | "evidence" | "summary">(
    "steps"
  );
  const [exportFlash, setExportFlash] = useState<string | undefined>();
  const [autoApprove, setAutoApprove] = useState(true);
  const [history, setHistory] = useState<SpecHistoryEntry[]>(() =>
    typeof localStorage !== "undefined" ? loadSpecHistory() : []
  );
  const [stubDiff, setStubDiff] = useState<
    Array<{ kind: "same" | "del" | "add"; text: string }> | undefined
  >();
  const [compareBusy, setCompareBusy] = useState(false);
  const yamlRef = useRef<HTMLTextAreaElement>(null);

  const flashExport = useCallback((msg: string) => {
    setExportFlash(msg);
    window.setTimeout(() => setExportFlash(undefined), 1600);
  }, []);

  const onCopyYaml = useCallback(async () => {
    if (!yaml.trim()) return;
    const ok = await copyText(yaml);
    flashExport(ok ? "copied YAML" : "copy failed");
  }, [yaml, flashExport]);

  const onDownloadYaml = useCallback(() => {
    if (!yaml.trim()) return;
    downloadText("spec.yaml", yaml, "text/yaml;charset=utf-8");
    flashExport("downloaded spec.yaml");
  }, [yaml, flashExport]);

  const onCopyDryRun = useCallback(async () => {
    if (!runResult) return;
    const ok = await copyText(JSON.stringify(runResult, null, 2));
    flashExport(ok ? "copied dry-run JSON" : "copy failed");
  }, [runResult, flashExport]);

  const onDownloadDryRun = useCallback(() => {
    if (!runResult) return;
    downloadText(
      "spec-dry-run.json",
      JSON.stringify(runResult, null, 2),
      "application/json;charset=utf-8"
    );
    flashExport("downloaded spec-dry-run.json");
  }, [runResult, flashExport]);

  const onCopyHash = useCallback(async () => {
    const hash = runResult?.specHash ?? lowered?.specHash;
    if (!hash) return;
    const ok = await copyText(hash);
    flashExport(ok ? "copied specHash" : "copy failed");
  }, [runResult, lowered, flashExport]);

  const jumpToIssue = useCallback(
    (issue: Pick<SpecValidationIssue, "path" | "stepId" | "ruleId">) => {
      const line = findYamlIssueLine(yaml, issue);
      focusYamlLine(yamlRef.current, yaml, line);
    },
    [yaml]
  );

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
      const sec = Math.floor((Date.now() - started) / 1000);
      setBusyElapsedSec(sec);
      setBusyLabel((prev) => {
        if (!prev || !prev.toLowerCase().includes("scaffold")) return prev;
        const provider = prev.match(/with (\S+)/)?.[1];
        const phase = scaffoldPhaseLabel(sec);
        return provider
          ? `Scaffolding with ${provider} · ${phase}`
          : `Scaffolding · ${phase}`;
      });
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
    setScaffoldNote(undefined);
    try {
      const provider = await fetchScaffoldProvider(settings);
      setBusyLabel(`Scaffolding with ${provider}… often 30–90s`);
      // Prefer live LLM on the shell when a key is present; shell falls back to stub.
      const res = await scaffoldSpec(settings, intent);
      if (res.yaml) setYaml(res.yaml);
      setMode(res.mode);
      setScaffoldAttempts(res.attempts);
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
      } else if (res.ok) {
        setValidation(undefined);
      }
      const outcome = resolveScaffoldOutcome({
        ok: res.ok,
        mode: res.mode,
        yaml: res.yaml,
        validation: res.validation
          ? res.validation
          : res.errors?.length
            ? { ok: false, errors: res.errors, warnings: [] }
            : undefined,
      });
      setScaffoldOutcome(outcome);
      if (outcome === "needs_edits") {
        setScaffoldNote(res.note);
        scrollToSpecStep("validate");
      }
      if (res.yaml?.trim()) {
        setHistory(
          pushSpecHistory({
            mode: res.mode,
            intentPreview: intent.trim().slice(0, 120),
            yaml: res.yaml,
          })
        );
        setStubDiff(undefined);
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

  const onCompareStub = useCallback(async () => {
    if (!yaml.trim() || !intent.trim()) return;
    setCompareBusy(true);
    setError(undefined);
    try {
      const stub = await scaffoldSpec(settings, intent, { stub: true });
      if (!stub.yaml) throw new Error("Stub scaffold returned no YAML");
      setStubDiff(lineDiff(stub.yaml, yaml));
      scrollToSpecStep("yaml");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCompareBusy(false);
    }
  }, [intent, settings, yaml]);

  const onLoadHistory = useCallback((entry: SpecHistoryEntry) => {
    setYaml(entry.yaml);
    setMode(entry.mode);
    setScaffoldOutcome(
      entry.mode === "stub" ? "stub" : entry.mode === "llm" ? "llm" : undefined
    );
    setStubDiff(undefined);
    setEvals(undefined);
    setLowered(undefined);
    setRunResult(undefined);
    setFrozenId(undefined);
    setForcePipeline(false);
    scrollToSpecStep("yaml");
  }, []);

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
      const res = await runSpec(settings, yaml, { autoApprove });
      setRunResult(res);
      if (!res.ok) {
        setValidation(res.validation);
        throw new Error(res.error || `Run ended ${res.state ?? "failed"}`);
      }
      if (!autoApprove && onOpenConsole) {
        flashExport("HITL may be waiting — open Console");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setBusyLabel(undefined);
    }
  }, [settings, yaml, autoApprove, onOpenConsole, flashExport]);

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
            {scaffoldOutcome
              ? ` · ${scaffoldOutcome.replace("_", " ")}`
              : mode
                ? ` · mode ${mode}`
                : ""}
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
              rows={8}
              value={intent}
              onInput={(e) => {
                setIntentPreset("custom");
                setIntent((e.target as HTMLTextAreaElement).value);
              }}
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
                  : scaffoldOutcome
                    ? "Retry scaffold"
                    : "Scaffold"}
              </button>
              {busy && busyLabel ? (
                <span class="hint mono" aria-live="polite">
                  {busyLabel}
                </span>
              ) : scaffoldGate.reason ? (
                <span class="hint mono">{scaffoldGate.reason}</span>
              ) : null}
            </div>
            <div class="spec-scaffold-meta" aria-live="polite">
              <div class="spec-outcome-chips" role="list">
                {(
                  [
                    ["llm", "llm"],
                    ["stub", "stub"],
                    ["needs_edits", "needs edits"],
                  ] as const
                ).map(([id, label]) => (
                  <span
                    key={id}
                    role="listitem"
                    class="spec-outcome-chip"
                    data-active={scaffoldOutcome === id ? "1" : "0"}
                    data-tone={id === "needs_edits" ? "warn" : "neutral"}
                  >
                    {label}
                  </span>
                ))}
              </div>
              {scaffoldAttempts != null ? (
                <span class="hint mono">attempts · {scaffoldAttempts}</span>
              ) : null}
              {scaffoldNote ? (
                <p class="tile-meta mono spec-scaffold-note">{scaffoldNote}</p>
              ) : null}
            </div>
          </div>
        </section>

        <section class="tile" data-spec-step="yaml">
          <div class="tile-stack">
            <div class="tile-head">
              <p class="tile-label">Spec YAML</p>
              <div class="cta-row spec-export-row">
                <button
                  type="button"
                  class="cta linkish"
                  disabled={!yaml.trim()}
                  onClick={() => void onCopyYaml()}
                >
                  Copy YAML
                </button>
                <button
                  type="button"
                  class="cta linkish"
                  disabled={!yaml.trim()}
                  onClick={onDownloadYaml}
                >
                  Download .yaml
                </button>
                <button
                  type="button"
                  class="cta linkish"
                  disabled={
                    !yaml.trim() ||
                    !intent.trim() ||
                    compareBusy ||
                    busy ||
                    scaffoldOutcome === "stub"
                  }
                  title="Diff current YAML against deterministic stub scaffold"
                  onClick={() => void onCompareStub()}
                >
                  {compareBusy ? "Comparing…" : "Diff vs stub"}
                </button>
              </div>
            </div>
            <textarea
              ref={yamlRef}
              class="spec-textarea mono"
              rows={14}
              value={yaml}
              placeholder="Scaffold an Intent to populate YAML"
              onInput={(e) => setYaml((e.target as HTMLTextAreaElement).value)}
              spellcheck={false}
            />
            {stubDiff ? (
              <div class="spec-diff">
                <div class="tile-head">
                  <p class="tile-meta mono">diff · stub (−) vs current (+)</p>
                  <button
                    type="button"
                    class="cta linkish"
                    onClick={() => setStubDiff(undefined)}
                  >
                    Clear
                  </button>
                </div>
                <pre class="spec-pre spec-pre-expanded spec-diff-pre">
                  {stubDiff.map((line, i) => (
                    <span
                      key={`${line.kind}-${i}`}
                      class="spec-diff-line"
                      data-kind={line.kind}
                    >
                      {line.kind === "del"
                        ? `− ${line.text}`
                        : line.kind === "add"
                          ? `+ ${line.text}`
                          : `  ${line.text}`}
                      {"\n"}
                    </span>
                  ))}
                </pre>
              </div>
            ) : null}
            {history.length ? (
              <div class="spec-history">
                <p class="tile-meta mono">recent scaffolds</p>
                <ul class="spec-history-list">
                  {history.map((h) => (
                    <li key={h.id}>
                      <button
                        type="button"
                        class="cta linkish"
                        disabled={busy}
                        onClick={() => onLoadHistory(h)}
                      >
                        load
                      </button>
                      <span class="mono muted">
                        {h.mode ?? "?"} · {h.at.slice(0, 19).replace("T", " ")} ·{" "}
                        {h.intentPreview.slice(0, 48)}
                        {h.intentPreview.length > 48 ? "…" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
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
                {validation.errors.length || validation.warnings?.length ? (
                  <div class="spec-diag-scroll">
                    <table class="spec-diag-table">
                      <thead>
                        <tr>
                          <th scope="col">Sev</th>
                          <th scope="col">Code</th>
                          <th scope="col">Where</th>
                          <th scope="col">Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {validation.errors.map((e, i) => (
                          <tr key={`e-${e.code}-${i}`}>
                            <td class="mono">err</td>
                            <td class="mono">{e.code}</td>
                            <td class="mono">
                              <button
                                type="button"
                                class="spec-diag-jump"
                                disabled={
                                  findYamlIssueLine(yaml, e) < 0
                                }
                                title="Jump to YAML"
                                onClick={() => jumpToIssue(e)}
                              >
                                {[e.stepId, e.path, e.ruleId]
                                  .filter(Boolean)
                                  .join(" · ") || "—"}
                              </button>
                            </td>
                            <td>{e.message}</td>
                          </tr>
                        ))}
                        {(validation.warnings ?? []).map((e, i) => (
                          <tr key={`w-${e.code}-${i}`} data-sev="warn">
                            <td class="mono">warn</td>
                            <td class="mono">{e.code}</td>
                            <td class="mono">
                              <button
                                type="button"
                                class="spec-diag-jump"
                                disabled={
                                  findYamlIssueLine(yaml, e) < 0
                                }
                                title="Jump to YAML"
                                onClick={() => jumpToIssue(e)}
                              >
                                {[e.stepId, e.path, e.ruleId]
                                  .filter(Boolean)
                                  .join(" · ") || "—"}
                              </button>
                            </td>
                            <td>{e.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p class="tile-meta">No issues</p>
                )}
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
                  <div class="spec-diag-scroll">
                    <table class="spec-diag-table">
                      <thead>
                        <tr>
                          <th scope="col">Case</th>
                          <th scope="col">Result</th>
                          <th scope="col">Detail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {evals.report.cases.map((c) => {
                          const failing = (c.results ?? []).filter(
                            (r) => !r.ok
                          );
                          const detail =
                            c.error ||
                            failing
                              .map(
                                (r) =>
                                  `${r.ruleId} got=${r.passed} want=${
                                    r.expected ?? "pass"
                                  }`
                              )
                              .join("; ") ||
                            (c.passed ? "—" : "failed");
                          return (
                            <tr
                              key={c.caseId}
                              data-sev={c.passed ? "ok" : "err"}
                            >
                              <td class="mono">{c.caseId}</td>
                              <td class="mono">
                                {c.passed ? "pass" : "fail"}
                              </td>
                              <td>{detail}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
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
            <p class="tile-label">Freeze</p>
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
            {freezeGate.reason && !freezeGate.enabled ? (
              <p class="tile-meta mono spec-gate-hint">{freezeGate.reason}</p>
            ) : forcePipeline && !evalsPassed ? (
              <p class="tile-meta mono spec-gate-hint">
                force · freeze unlocked
              </p>
            ) : null}
            {frozenId ? (
              <p class="tile-meta mono">frozen · {frozenId}</p>
            ) : (
              <p class="tile-meta">
                Optional before dry-run — Run also freezes a throwaway copy.
              </p>
            )}
          </div>
        </section>

        <section class="tile spec-tile-wide" data-spec-step="run">
          <div class="tile-stack">
            <div class="tile-head">
              <p class="tile-label">Dry-run</p>
              {runResult ? (
                <p class="tile-meta mono">
                  {runResult.state ?? (runResult.ok ? "COMPLETE" : "FAILED")}
                  {runResult.evidenceCount != null
                    ? ` · evidence ${runResult.evidenceCount}`
                    : ""}
                </p>
              ) : null}
            </div>
            <div class="cta-row">
              <button
                type="button"
                class="cta"
                disabled={!runGate.enabled}
                title={runGate.reason}
                onClick={() => {
                  setRunTab("steps");
                  void onRun();
                }}
              >
                {busy && busyLabel?.startsWith("Running")
                  ? "Running…"
                  : "Run dry"}
              </button>
              <label class="spec-check mono">
                <input
                  type="checkbox"
                  checked={autoApprove}
                  disabled={busy}
                  onChange={(e) =>
                    setAutoApprove((e.target as HTMLInputElement).checked)
                  }
                />
                auto-approve HITL
              </label>
              {!autoApprove && onOpenConsole ? (
                <button
                  type="button"
                  class="cta linkish"
                  onClick={onOpenConsole}
                >
                  Open Console
                </button>
              ) : null}
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
              <button
                type="button"
                class="cta linkish"
                disabled={!runResult}
                onClick={() => void onCopyDryRun()}
              >
                Copy JSON
              </button>
              <button
                type="button"
                class="cta linkish"
                disabled={!runResult}
                onClick={onDownloadDryRun}
              >
                Download .json
              </button>
              <button
                type="button"
                class="cta linkish"
                disabled={!(runResult?.specHash ?? lowered?.specHash)}
                onClick={() => void onCopyHash()}
              >
                Copy hash
              </button>
            </div>
            {exportFlash ? (
              <p class="tile-meta mono spec-export-flash" aria-live="polite">
                {exportFlash}
              </p>
            ) : null}
            {!autoApprove ? (
              <p class="tile-meta">
                Auto-approve off — dry-run may wait on HITL; use Console cards
                when FEEDBACK_ADAPTER=desk.
              </p>
            ) : null}
            {runGate.reason && !runGate.enabled ? (
              <p class="tile-meta mono spec-gate-hint">{runGate.reason}</p>
            ) : freezeGateHint && forcePipeline ? (
              <p class="tile-meta mono spec-gate-hint">{freezeGateHint}</p>
            ) : null}

            <div class="spec-run-tabs" role="tablist" aria-label="Dry-run views">
              {(
                [
                  ["steps", "Steps"],
                  ["evidence", "Evidence"],
                  ["summary", "Summary"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  class="spec-run-tab"
                  aria-selected={runTab === id}
                  data-active={runTab === id ? "1" : "0"}
                  onClick={() => setRunTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            {!runResult ? (
              <p class="tile-meta">
                Run dry to populate fixtures + stub LLM trail. HITL is
                auto-approved here; live cards stay on Console.
              </p>
            ) : runTab === "steps" ? (
              Object.keys(runResult.stepOutputs ?? {}).length ? (
                <pre class="spec-pre spec-pre-expanded">
                  {JSON.stringify(runResult.stepOutputs, null, 2)}
                </pre>
              ) : (
                <p class="tile-meta">No step outputs in this run.</p>
              )
            ) : runTab === "evidence" ? (
              runResult.evidence?.length ? (
                <pre class="spec-pre spec-pre-expanded">
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
              ) : (
                <p class="tile-meta">
                  No evidence entries
                  {runResult.evidenceCount
                    ? ` (count ${runResult.evidenceCount})`
                    : ""}
                  .
                </p>
              )
            ) : (
              <div class="tile-copy">
                <h2 class="tile-title">
                  {runResult.state ?? (runResult.ok ? "COMPLETE" : "FAILED")}
                </h2>
                <p class="tile-meta mono">
                  evidence · {runResult.evidenceCount ?? 0}
                  {runResult.specId ? ` · id ${runResult.specId}` : ""}
                </p>
                {runResult.specHash ? (
                  <p class="tile-meta mono">hash · {runResult.specHash}</p>
                ) : null}
                {runResult.note ? (
                  <p class="tile-meta">{runResult.note}</p>
                ) : null}
                {runResult.stageResults &&
                Object.keys(runResult.stageResults).length ? (
                  <pre class="spec-pre">
                    {JSON.stringify(runResult.stageResults, null, 2)}
                  </pre>
                ) : null}
              </div>
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
