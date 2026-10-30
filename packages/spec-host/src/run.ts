import {
  AgentRuntimeEvent,
  createDraftSpecV2,
  freezeSpecV2,
  type SpecV2,
  type SpecV2Body,
} from "@relay/protocol";
import {
  assertEvalsGate,
  runEvals,
  type EvalReport,
} from "@relay/spec-evals";
import { lowerSpecV2 } from "@relay/spec-lower";
import { validateSpecV2 } from "@relay/spec-validator";
import {
  createWorkflowRuntime,
  getEvidence,
} from "@relay/workflow-runtime";
import { SpecHostError } from "./errors.js";
import { buildSpecEngines, resolveHostDefaults } from "./engines.js";
import { selectServicesForSpec } from "./services.js";
import type { RunSpecOptions, RunSpecResult } from "./types.js";

function bodyFromOptions(options: RunSpecOptions): SpecV2Body {
  if (options.frozen) {
    const {
      id: _id,
      version: _version,
      status: _status,
      intentId: _intentId,
      createdAt: _createdAt,
      frozenAt: _frozenAt,
      frozenBy: _frozenBy,
      contentHash: _contentHash,
      procedure: _procedure,
      ...body
    } = options.frozen;
    return body;
  }
  if (options.body) return options.body;
  throw new SpecHostError(
    "missing_spec",
    "runSpec requires body or frozen Spec"
  );
}

/**
 * Generic Spec v2 host: validate → freeze → lower → optional evals → run.
 * Engines are built from Spec.services against the caller-supplied catalog —
 * no hardcoded Reddit/Desk fixtures inside this package.
 */
export async function runSpec(
  options: RunSpecOptions
): Promise<RunSpecResult> {
  const body = bodyFromOptions(options);
  const selected = selectServicesForSpec(body, options.services);
  if (!selected.ok) {
    throw new SpecHostError(
      "missing_services",
      `Spec references unknown services: ${selected.missing.join(", ")}`,
      { missing: selected.missing }
    );
  }

  if (!options.skipValidate) {
    const validation = validateSpecV2(body, {
      services: options.services,
      knownConnections: options.knownConnections,
    });
    if (!validation.ok) {
      throw new SpecHostError(
        "invalid_spec",
        `Spec validation failed (${validation.errors.length} error(s))`,
        { validation }
      );
    }
  }

  const frozen: SpecV2 =
    options.frozen ??
    freezeSpecV2(
      createDraftSpecV2({
        ...body,
        id: options.draftId,
        intentId: options.intentId,
      }),
      { frozenBy: options.frozenBy ?? "spec-host" }
    );

  const lowered = lowerSpecV2(frozen, {
    name: options.name ?? "spec-host-run",
    specId: frozen.id,
    specRecord: {
      id: frozen.id,
      version: frozen.version,
      status: frozen.status,
      intentId: frozen.intentId,
    },
  });

  const { dryRun, blockNetwork } = resolveHostDefaults({
    mode: options.mode,
    dryRun: options.dryRun,
    blockNetwork: options.blockNetwork,
    budgetDryRun: body.budget?.dryRun,
  });

  const engines = buildSpecEngines({
    services: selected.services,
    llmClient: options.llmClient,
    resolveConnection: options.resolveConnection,
    apiFixtures: options.apiFixtures,
    dryRun,
    blockNetwork,
    fetch: options.fetch,
    extraEngines: options.extraEngines,
  });

  let evalReport: EvalReport | undefined;
  if (options.evals?.cases.length) {
    evalReport = await runEvals({
      lowered,
      softFailClosed: options.evals.softFailClosed ?? false,
      llmEngine: engines.llm,
      fixtures: { cases: [...options.evals.cases] },
    });
    try {
      assertEvalsGate(evalReport);
    } catch (err) {
      throw new SpecHostError(
        "evals_gate",
        err instanceof Error ? err.message : String(err),
        { evalReport }
      );
    }
  }

  const context = {
    agentId: options.context?.agentId ?? "spec-host-1",
    userId: options.context?.userId ?? "operator",
    sessionId: options.context?.sessionId ?? `spec-host-${Date.now()}`,
    ...options.context,
  };

  const { runtime } = createWorkflowRuntime({
    lowered,
    engines,
    context,
    assertRunnable: options.assertRunnable ?? false,
    softFailClosed: options.softFailClosed ?? true,
  });

  const hitl = options.hitl ?? {};
  const autoApprove = hitl.autoApprove ?? true;
  if (hitl.onFeedbackRequested) {
    runtime.on(AgentRuntimeEvent.FEEDBACK_REQUESTED, (req) => {
      void hitl.onFeedbackRequested?.(req, async (partial) => {
        await runtime.provideFeedback({
          requestId: req.id,
          agentId: req.agentId,
          action: partial.action,
          value: partial.value,
        });
      });
    });
  } else if (autoApprove) {
    runtime.on(AgentRuntimeEvent.FEEDBACK_REQUESTED, (req) => {
      void runtime.provideFeedback({
        requestId: req.id,
        agentId: req.agentId,
        action: "proceed",
        value: true,
      });
    });
  }

  await runtime.start();
  const ctx = runtime.getContext();
  const evidence = getEvidence(ctx);
  const steps = (ctx.steps ?? {}) as Record<string, { output?: unknown }>;
  const stepOutputs: Record<string, unknown> = {};
  for (const [id, bag] of Object.entries(steps)) {
    stepOutputs[id] = bag?.output;
  }

  return {
    ok: runtime.getState() === "COMPLETE",
    state: runtime.getState(),
    specId: frozen.id,
    specHash: lowered.specHash,
    frozen,
    lowered,
    evidence,
    evidenceCount: evidence.length,
    stepOutputs,
    stageResults: (ctx.stageResults ?? {}) as Record<string, unknown>,
    evalReport,
    runtime,
  };
}
