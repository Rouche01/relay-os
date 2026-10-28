import type {
  AgentContext,
  ExecutionEngine,
  SpecV2Body,
  SpecV2Rule,
} from "@relay/protocol";
import { AgentRuntimeEvent } from "@relay/protocol";
import {
  assertLoweredRunnable,
  lowerSpecV2,
  type LoweredWorkflow,
} from "@relay/spec-lower";
import {
  createWorkflowRuntime,
  EnforceError,
  enforceRules,
  getEvidence,
  type RefScope,
} from "@relay/workflow-runtime";
import { compileEvals, evaluableRules } from "./compile.js";
import type {
  CaseEvalResult,
  CaseRuleResult,
  DryRunEvalResult,
  EvalCase,
  EvalReport,
  RunEvalsOptions,
} from "./types.js";

/**
 * Run compiled evals against fixture cases (+ optional workflow dry-run gate).
 */
export async function runEvals(options: RunEvalsOptions): Promise<EvalReport> {
  const { body, lowered } = resolveSource(options);
  const compiled = compileEvals(lowered ?? body);
  const rules = body.rules ?? [];
  const softFailClosed = options.softFailClosed ?? true;

  const cases: CaseEvalResult[] = [];
  const errors: string[] = [];

  for (const c of options.fixtures.cases) {
    const result = await runCase(c, body, rules, options.llmEngine, softFailClosed);
    cases.push(result);
    if (!result.passed) {
      errors.push(
        result.error ??
          `Case ${JSON.stringify(c.id)} failed: ${summarizeCase(result)}`
      );
    }
  }

  let dryRun: DryRunEvalResult | undefined;
  if (options.dryRun) {
    const wf = lowered ?? lowerSpecV2(body);
    dryRun = await runDryRunGate(wf, options.dryRun);
    if (!dryRun.passed) {
      errors.push(dryRun.error ?? "Dry-run eval gate failed");
    }
  }

  const passed =
    cases.every((c) => c.passed) && (dryRun === undefined || dryRun.passed);

  return { compiled, cases, dryRun, passed, errors };
}

async function runCase(
  c: EvalCase,
  body: SpecV2Body,
  rules: SpecV2Rule[],
  llmEngine: ExecutionEngine | undefined,
  softFailClosed: boolean
): Promise<CaseEvalResult> {
  try {
    const ruleIds = resolveCaseRules(c, body);
    const scope = buildCaseScope(c);
    const output = c.output;

    let enforceResults;
    try {
      enforceResults = await enforceRules({
        ruleIds,
        rules,
        output,
        scope,
        llmEngine,
        softFailClosed,
      });
    } catch (err) {
      if (err instanceof EnforceError) {
        enforceResults = err.results;
      } else {
        throw err;
      }
    }

    const byId = new Map(enforceResults.map((r) => [r.ruleId, r]));
    const results: CaseRuleResult[] = [];

    for (const id of ruleIds) {
      const got = byId.get(id);
      const expected = expectedFor(c, id);
      const passed = got?.passed ?? false;
      const ok = expected === undefined ? passed : passed === expected;
      results.push({
        ruleId: id,
        kind: got?.kind ?? rules.find((r) => r.id === id)?.kind ?? "hard",
        passed,
        expected,
        ok,
        detail: got?.detail,
      });
    }

    // Outcome stubs listed explicitly: always "ok" (declared only).
    for (const id of ruleIds) {
      const rule = rules.find((r) => r.id === id);
      if (rule?.kind === "outcome") {
        const idx = results.findIndex((r) => r.ruleId === id);
        const entry: CaseRuleResult = {
          ruleId: id,
          kind: "outcome",
          passed: true,
          expected: expectedFor(c, id) ?? true,
          ok: true,
          detail: { deferred: true, metric: rule.metric },
        };
        if (idx >= 0) results[idx] = entry;
        else results.push(entry);
      }
    }

    const allOk = results.every((r) => r.ok);
    let casePassed: boolean;
    if (c.expect?.rules) {
      casePassed = allOk;
    } else if (c.expect?.pass === false) {
      // Negative case: at least one rule must actually fail.
      casePassed = results.some((r) => !r.passed);
    } else {
      casePassed = results.every((r) => r.passed);
    }

    return { caseId: c.id, passed: casePassed, results };
  } catch (err) {
    return {
      caseId: c.id,
      passed: false,
      results: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function resolveCaseRules(c: EvalCase, body: SpecV2Body): string[] {
  if (c.rules?.length) return [...c.rules];
  if (c.stepId) {
    const step = body.steps.find((s) => s.id === c.stepId);
    if (step?.enforce?.length) return [...step.enforce];
  }
  return evaluableRules(body.rules ?? []).map((r) => r.id);
}

function expectedFor(c: EvalCase, ruleId: string): boolean | undefined {
  if (c.expect?.rules && ruleId in c.expect.rules) {
    return c.expect.rules[ruleId];
  }
  return undefined;
}

function buildCaseScope(c: EvalCase): RefScope {
  const scope: RefScope = { ...(c.scope ?? {}) };
  if (c.output !== undefined) {
    scope.output = c.output;
    if (c.stepId && scope[c.stepId] === undefined) {
      scope[c.stepId] = c.output;
    }
  }
  return scope;
}

async function runDryRunGate(
  lowered: LoweredWorkflow,
  dryRun: NonNullable<RunEvalsOptions["dryRun"]>
): Promise<DryRunEvalResult> {
  try {
    assertLoweredRunnable(lowered, { validate: false });
    const context: AgentContext = {
      agentId: dryRun.context?.agentId ?? "eval-dry-run",
      userId: dryRun.context?.userId ?? "eval-user",
      sessionId: dryRun.context?.sessionId ?? `eval-${Date.now()}`,
      ...dryRun.context,
    };

    const { runtime } = createWorkflowRuntime({
      lowered,
      engines: dryRun.engines,
      context,
      assertRunnable: false,
      softFailClosed: dryRun.softFailClosed ?? false,
    });

    runtime.on(AgentRuntimeEvent.FEEDBACK_REQUESTED, (req) => {
      void runtime.provideFeedback({
        requestId: req.id,
        agentId: req.agentId,
        action: "proceed",
        value: true,
      });
    });

    await runtime.start();
    const state = runtime.getState();
    const passed = state === "COMPLETE";
    return {
      ran: true,
      state,
      passed,
      evidenceCount: getEvidence(runtime.getContext()).length,
      error: passed ? undefined : `Dry-run ended in state ${state}`,
    };
  } catch (err) {
    return {
      ran: true,
      passed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function resolveSource(options: RunEvalsOptions): {
  body: SpecV2Body;
  lowered?: LoweredWorkflow;
} {
  if (options.lowered) {
    return { body: options.lowered.spec, lowered: options.lowered };
  }
  if (options.spec) {
    return { body: options.spec };
  }
  throw new Error("runEvals requires spec or lowered");
}

function summarizeCase(result: CaseEvalResult): string {
  return result.results
    .filter((r) => !r.ok)
    .map(
      (r) =>
        `${r.ruleId}: got=${r.passed} expected=${r.expected ?? "pass"}`
    )
    .join("; ");
}
