import { useCallback, useState } from "preact/hooks";
import type { DeskSettings } from "../gateway/types.ts";
import {
  evalSpec,
  freezeSpec,
  lowerSpec,
  runSpec,
  scaffoldSpec,
  validateSpec,
} from "./client.ts";
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

/**
 * Spec governance surface — Intent → scaffold → validate → evals → lower → freeze → run.
 * HITL cards stay on Console.
 */
export function SpecSurface({ settings }: Props) {
  const [intent, setIntent] = useState(DEFAULT_CE_INTENT);
  const [yaml, setYaml] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [mode, setMode] = useState<string | undefined>();
  const [validation, setValidation] = useState<SpecValidationResult | undefined>();
  const [evals, setEvals] = useState<EvalsResponse | undefined>();
  const [lowered, setLowered] = useState<LowerResponse | undefined>();
  const [frozenId, setFrozenId] = useState<string | undefined>();
  const [runResult, setRunResult] = useState<RunResponse | undefined>();

  const rules = (() => {
    try {
      if (!yaml.trim()) return [];
      // Rules shown from last scaffold body via validation path — parse lightly from YAML text
      return extractRulesFromYaml(yaml);
    } catch {
      return [];
    }
  })();

  const onScaffold = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    setRunResult(undefined);
    setFrozenId(undefined);
    try {
      const res = await scaffoldSpec(settings, intent, { stub: true });
      if (!res.ok || !res.yaml) {
        throw new Error(
          res.error ||
            res.errors?.map((e) => e.message).join("; ") ||
            "Scaffold failed"
        );
      }
      setYaml(res.yaml);
      setMode(res.mode);
      setValidation(res.validation);
      setEvals(undefined);
      setLowered(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [intent, settings]);

  const onValidate = useCallback(async () => {
    if (!yaml.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await validateSpec(settings, yaml);
      setValidation(res.validation);
      if (res.yaml) setYaml(res.yaml);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [settings, yaml]);

  const onEvals = useCallback(async () => {
    if (!yaml.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await evalSpec(settings, yaml);
      setEvals(res);
      if (!res.ok) {
        setError(
          res.report?.errors?.join("; ") || "Evals failed — live run gated"
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [settings, yaml]);

  const onLower = useCallback(async () => {
    if (!yaml.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await lowerSpec(settings, yaml);
      setLowered(res);
      if (!res.ok) {
        setValidation(res.validation);
        throw new Error(res.error || "Lower failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [settings, yaml]);

  const onFreeze = useCallback(async () => {
    if (!yaml.trim()) return;
    setBusy(true);
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
    }
  }, [settings, yaml]);

  const onRun = useCallback(async () => {
    if (!yaml.trim()) return;
    setBusy(true);
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
    }
  }, [settings, yaml]);

  return (
    <div class="desk-body spec-surface">
      <div class="console-head">
        <h1 class="console-title">Spec</h1>
        <p class="console-sub">
          intent → scaffold → validate → evals → freeze → run · HITL stays in
          Console
        </p>
      </div>

      <div class="spec-grid">
        <section class="tile">
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
                disabled={busy || !intent.trim()}
                onClick={() => void onScaffold()}
              >
                Scaffold
              </button>
              {mode ? <span class="hint mono">mode · {mode}</span> : null}
            </div>
          </div>
        </section>

        <section class="tile">
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
                disabled={busy || !yaml.trim()}
                onClick={() => void onValidate()}
              >
                Validate
              </button>
              <button
                type="button"
                class="cta ghost"
                disabled={busy || !yaml.trim()}
                onClick={() => void onEvals()}
              >
                Evals
              </button>
              <button
                type="button"
                class="cta ghost"
                disabled={busy || !yaml.trim()}
                onClick={() => void onLower()}
              >
                Lower
              </button>
            </div>
          </div>
        </section>

        <section class="tile">
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

        <section class="tile">
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
                  evals · {evals.report.passed ? "pass" : "fail"} ·{" "}
                  {evals.report.cases.map((c) => c.caseId).join(", ")}
                </p>
              </div>
            ) : null}
            {evals?.compiled?.uncovered?.length ? (
              <p class="tile-meta warn">
                uncovered · {evals.compiled.uncovered.join(", ")}
              </p>
            ) : null}
          </div>
        </section>

        <section class="tile">
          <div class="tile-stack">
            <p class="tile-label">Manifest</p>
            {lowered?.ok ? (
              <div class="tile-copy">
                <h2 class="tile-title">{String(lowered.manifest?.name ?? "workflow")}</h2>
                <p class="tile-meta mono">
                  hash · {lowered.specHash?.slice(0, 16)}…
                </p>
                <pre class="spec-pre">
                  {JSON.stringify(
                    {
                      stages: (lowered.manifest?.stages as unknown[])?.map(
                        (s) =>
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

        <section class="tile">
          <div class="tile-stack">
            <p class="tile-label">Freeze / run</p>
            <div class="cta-row">
              <button
                type="button"
                class="cta"
                disabled={busy || !yaml.trim()}
                onClick={() => void onFreeze()}
              >
                Freeze
              </button>
              <button
                type="button"
                class="cta"
                disabled={busy || !yaml.trim()}
                onClick={() => void onRun()}
              >
                Run dry
              </button>
            </div>
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
              </div>
            ) : (
              <p class="tile-meta">
                Dry-run auto-approves HITL. Live negotiate cards stay on Console.
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
