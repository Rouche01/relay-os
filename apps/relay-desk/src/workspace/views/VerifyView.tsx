import { useCallback, useMemo, useState } from "preact/hooks";
import type { DeskSettings } from "../../gateway/types.ts";
import { evalSpec, lowerSpec, validateSpec } from "../../spec/client.ts";
import {
  deriveSchematic,
  irreversibleSteps,
} from "../../spec/schematic.ts";
import type { SpecValidationIssue } from "../../spec/types.ts";
import {
  updateDraft,
  type DraftRecord,
} from "../../specs/draft-store.ts";

export type VerifyViewProps = {
  draft: DraftRecord;
  settings: DeskSettings;
  onDraftUpdated: (draft: DraftRecord) => void;
  onJumpToDesign: (
    issue: Pick<SpecValidationIssue, "path" | "stepId" | "ruleId">
  ) => void;
};

function stageNames(manifest: Record<string, unknown> | undefined): string[] {
  const stages = manifest?.stages;
  if (!Array.isArray(stages)) return [];
  return stages.map((s) => {
    if (typeof s === "object" && s && "name" in s) {
      return String((s as { name: unknown }).name);
    }
    return String(s);
  });
}

function enginesRequired(
  manifest: Record<string, unknown> | undefined
): string[] {
  const e = manifest?.engines_required;
  return Array.isArray(e) ? e.map(String) : [];
}

export function VerifyView({
  draft,
  settings,
  onDraftUpdated,
  onJumpToDesign,
}: VerifyViewProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const validation = draft.validation;
  const evals = draft.evals;

  const schematic = useMemo(
    () => deriveSchematic({ body: draft.body, manifest: draft.manifest }),
    [draft.body, draft.manifest]
  );
  const irreversible = irreversibleSteps(schematic);

  const structureOk = validation?.ok === true;
  const evalsOk =
    evals?.ok === true || evals?.report?.passed === true;
  const allPassed = structureOk && evalsOk;
  const hasRun = Boolean(validation || evals);

  const summary = !hasRun
    ? "Not checked yet"
    : allPassed
      ? "All checks passed"
      : !structureOk
        ? "Structure checks failed"
        : "Rules-from-intent checks failed";

  const onRunChecks = useCallback(async () => {
    if (!draft.yaml.trim()) {
      setError("No Spec YAML — open Design first");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const v = await validateSpec(settings, draft.yaml);
      let nextEvals = draft.evals;
      let nextManifest = draft.manifest;
      let nextHash = draft.specHash;
      let nextBody = v.body ?? draft.body;

      if (v.ok) {
        const e = await evalSpec(settings, draft.yaml);
        nextEvals = e;
        if (e.ok || e.report?.passed) {
          const low = await lowerSpec(settings, draft.yaml);
          if (low.ok && low.manifest) {
            nextManifest = low.manifest;
            nextHash = low.specHash ?? nextHash;
          }
        }
      }

      const checksPassed =
        v.ok === true &&
        (nextEvals?.ok === true || nextEvals?.report?.passed === true);

      const updated = updateDraft(draft.id, {
        yaml: draft.yaml,
        body: nextBody,
        validation: v.validation,
        evals: nextEvals,
        manifest: nextManifest,
        specHash: nextHash,
        status:
          draft.status === "needs_catalog"
            ? "needs_catalog"
            : draft.status === "frozen"
              ? "frozen"
              : checksPassed
                ? "checks_passed"
                : "draft",
      });
      if (updated) onDraftUpdated(updated);
      if (!v.ok) {
        setError(
          v.validation.errors
            .slice(0, 2)
            .map((e) => e.message)
            .join(" · ") || "Validate failed"
        );
      } else if (nextEvals && !checksPassed) {
        setError(
          nextEvals.error ||
            nextEvals.report?.errors?.slice(0, 2).join(" · ") ||
            "Evals failed"
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [draft, settings, onDraftUpdated]);

  const issues: SpecValidationIssue[] = [
    ...(validation?.errors ?? []),
    ...(validation?.warnings ?? []),
  ];

  return (
    <div class="verify-view">
      <section class="tile verify-summary">
        <div class="tile-stack">
          <div class="tile-head">
            <p class="tile-label">Checks</p>
            <button
              type="button"
              class="cta"
              disabled={busy || !draft.yaml.trim()}
              onClick={() => void onRunChecks()}
            >
              {busy ? "Running…" : hasRun ? "Re-run checks" : "Run checks"}
            </button>
          </div>
          <h2 class="tile-title" data-tone={allPassed ? "ok" : hasRun ? "bad" : "idle"}>
            {summary}
          </h2>
          <p class="tile-meta">
            {hasRun
              ? structureOk
                ? evalsOk
                  ? "Structure and rules-from-intent both look good."
                  : "Structure is fine; fix the rules cases below."
                : "Fix structure issues in Design, then re-run."
              : "Run checks before shipping."}
          </p>
          {error ? <p class="error">{error}</p> : null}
        </div>
      </section>

      {irreversible.length ? (
        <section class="tile verify-risk">
          <div class="tile-stack">
            <p class="tile-label">Irreversible</p>
            <h2 class="tile-title">
              {irreversible.length === 1
                ? `One step can't be undone: ${irreversible[0]!.id}`
                : `${irreversible.length} steps can't be undone`}
            </h2>
            <ul class="verify-risk-list">
              {irreversible.map((step) => (
                <li key={step.id}>
                  <button
                    type="button"
                    class="cta linkish"
                    onClick={() => onJumpToDesign({ stepId: step.id })}
                  >
                    <span class="mono">{step.id}</span>
                  </button>
                  <span class="tile-meta">
                    {[
                      step.use,
                      step.once ? "once keyed" : null,
                      schematic.steps.some((s) => s.kind === "hitl")
                        ? "HITL in this Spec"
                        : "no HITL step yet",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <section class="tile" data-spec-step="validate">
        <div class="tile-stack">
          <p class="tile-label">Structure</p>
          {validation ? (
            <>
              <p class="tile-meta mono">
                {validation.ok ? "pass" : "fail"} · {validation.errors.length}{" "}
                errors · {validation.warnings?.length ?? 0} warnings
              </p>
              {issues.length ? (
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
                      {issues.map((e, i) => (
                        <tr
                          key={`${e.code}-${i}`}
                          data-sev={e.severity === "error" ? "err" : "warn"}
                        >
                          <td class="mono">{e.severity === "error" ? "err" : "warn"}</td>
                          <td class="mono">{e.code}</td>
                          <td class="mono">
                            <button
                              type="button"
                              class="spec-diag-jump"
                              title="Open in Design YAML"
                              onClick={() =>
                                onJumpToDesign({
                                  path: e.path,
                                  stepId: e.stepId,
                                  ruleId: e.ruleId,
                                })
                              }
                            >
                              {[e.stepId, e.path, e.ruleId]
                                .filter(Boolean)
                                .join(" · ") || "YAML"}
                            </button>
                          </td>
                          <td>{e.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p class="tile-meta">No structure issues</p>
              )}
            </>
          ) : (
            <p class="tile-meta">Run checks to see structure results</p>
          )}
        </div>
      </section>

      <section class="tile" data-spec-step="evals">
        <div class="tile-stack">
          <p class="tile-label">Rules from intent</p>
          {schematic.rules.length ? (
            <ul class="spec-rule-list">
              {schematic.rules.map((r) => (
                <li key={r.id}>
                  <span class="mono">{r.id}</span>
                  <span class="muted"> · {r.kind}</span>
                  {r.enforcedBy.length ? (
                    <span class="mono muted">
                      {" "}
                      · on {r.enforcedBy.join(", ")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p class="tile-meta">Rules appear once the Spec has a body</p>
          )}
          {evals?.report ? (
            <>
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
                        const failing = (c.results ?? []).filter((r) => !r.ok);
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
            </>
          ) : (
            <p class="tile-meta">Run checks to evaluate rules</p>
          )}
          {evals?.compiled?.uncovered?.length ? (
            <p class="tile-meta warn">
              uncovered · {evals.compiled.uncovered.join(", ")}
            </p>
          ) : null}
        </div>
      </section>

      <section class="tile" data-spec-step="lower">
        <div class="tile-stack">
          <p class="tile-label">What it compiles to</p>
          {draft.manifest ? (
            <>
              <p class="tile-meta">
                {stageNames(draft.manifest).length
                  ? stageNames(draft.manifest).join(" → ")
                  : "Manifest ready"}
              </p>
              <p class="tile-meta mono">
                {draft.specHash ? `hash · ${draft.specHash}` : null}
                {enginesRequired(draft.manifest).length
                  ? ` · engines · ${enginesRequired(draft.manifest).join(", ")}`
                  : ""}
              </p>
            </>
          ) : (
            <p class="tile-meta">
              Compiles after structure and rules pass (or use Design → Manifest).
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
