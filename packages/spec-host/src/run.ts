import { FeedbackBroker } from "@relay/feedback-broker";
import { AgentRuntimeEvent } from "@relay/protocol";
import {
  createWorkflowRuntime,
  getEvidence,
} from "@relay/workflow-runtime";
import {
  cloneContext,
  newRunId,
  type SpecRunCheckpoint,
} from "./checkpoint.js";
import { SpecHostError } from "./errors.js";
import { countSimulatedWrites } from "./modes.js";
import { prepareSpecRun } from "./prepare.js";
import type { RunSpecOptions, RunSpecResult } from "./types.js";

function stepOutputsFromContext(ctx: Record<string, unknown>): Record<string, unknown> {
  const steps = (ctx.steps ?? {}) as Record<string, { output?: unknown }>;
  const stepOutputs: Record<string, unknown> = {};
  for (const [id, bag] of Object.entries(steps)) {
    stepOutputs[id] = bag?.output;
  }
  return stepOutputs;
}

/**
 * Generic Spec v2 host: validate → freeze → lower → optional evals → run.
 * Engines are built from Spec.services against the caller-supplied catalog —
 * no hardcoded Reddit/Desk fixtures inside this package.
 */
export async function runSpec(
  options: RunSpecOptions
): Promise<RunSpecResult> {
  const prepared = await prepareSpecRun(options);
  const { frozen, lowered, engines, mode, dryRun, blockNetwork, evalReport } =
    prepared;

  const hitl = options.hitl ?? {};
  const autoApprove = hitl.autoApprove ?? mode === "fixture";
  const pauseAndReturn =
    hitl.pauseAndReturn ??
    (!autoApprove && !hitl.adapter && !hitl.onFeedbackRequested);

  if (pauseAndReturn && !hitl.runStateStore) {
    throw new SpecHostError(
      "missing_run_store",
      "pauseAndReturn requires hitl.runStateStore (MemoryRunStateStore or FileRunStateStore)"
    );
  }

  const runId = hitl.runId ?? newRunId();
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
    runtimeOptions: {
      pauseOnHitl: pauseAndReturn,
    },
  });

  let broker: FeedbackBroker | undefined;
  if (hitl.adapter) {
    broker = new FeedbackBroker(runtime, { adapter: hitl.adapter });
    broker.attach();
  }

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
  broker?.detach();

  const ctx = runtime.getContext();
  const evidence = getEvidence(ctx);
  const stepOutputs = stepOutputsFromContext(ctx as Record<string, unknown>);
  const state = runtime.getState();

  let checkpoint: SpecRunCheckpoint | undefined;
  if (state === "WAITING_USER" && pauseAndReturn && hitl.runStateStore) {
    const pending = runtime.getPausedFeedbackRequest() ?? undefined;
    checkpoint = {
      version: 1,
      runId,
      specId: frozen.id,
      specHash: lowered.specHash,
      mode,
      status: "waiting_you",
      stageIndex: runtime.getCurrentStageIndex(),
      stageName:
        runtime.getActiveStages()[runtime.getCurrentStageIndex()]?.name ?? "",
      pendingFeedback: pending,
      context: cloneContext(ctx),
      frozen,
      body: prepared.body,
      dryRun,
      blockNetwork,
      savedAt: new Date().toISOString(),
    };
    await hitl.runStateStore.save(checkpoint);
  }

  return {
    ok: state === "COMPLETE",
    state,
    specId: frozen.id,
    specHash: lowered.specHash,
    frozen,
    lowered,
    evidence,
    evidenceCount: evidence.length,
    stepOutputs,
    stageResults: (ctx.stageResults ?? {}) as Record<string, unknown>,
    evalReport,
    mode,
    dryRun,
    blockNetwork,
    simulatedWriteCount: countSimulatedWrites(stepOutputs),
    runId: checkpoint ? runId : pauseAndReturn ? runId : undefined,
    checkpoint,
    pendingFeedback: checkpoint?.pendingFeedback,
    runtime,
  };
}
