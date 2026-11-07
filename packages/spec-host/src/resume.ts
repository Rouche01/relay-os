import { FeedbackBroker } from "@relay/feedback-broker";
import { AgentRuntimeEvent, type FeedbackResponse } from "@relay/protocol";
import {
  createWorkflowRuntime,
  getEvidence,
} from "@relay/workflow-runtime";
import {
  cloneContext,
  type SpecRunCheckpoint,
} from "./checkpoint.js";
import { SpecHostError } from "./errors.js";
import { countSimulatedWrites } from "./modes.js";
import { prepareSpecRun } from "./prepare.js";
import { withEnqueuedOutcomeFollowUps } from "./outcome-followups.js";
import { buildRunRecord, statusFromRuntimeState } from "./run-record.js";
import type { ResumeSpecOptions, RunSpecResult } from "./types.js";

function stepOutputsFromContext(ctx: Record<string, unknown>): Record<string, unknown> {
  const steps = (ctx.steps ?? {}) as Record<string, { output?: unknown }>;
  const stepOutputs: Record<string, unknown> = {};
  for (const [id, bag] of Object.entries(steps)) {
    stepOutputs[id] = bag?.output;
  }
  return stepOutputs;
}

async function loadCheckpoint(
  options: ResumeSpecOptions
): Promise<SpecRunCheckpoint> {
  if (options.checkpoint) return options.checkpoint;
  const runId = options.runId;
  const store = options.runStateStore ?? options.hitl?.runStateStore;
  if (!runId || !store) {
    throw new SpecHostError(
      "missing_checkpoint",
      "resumeSpec requires checkpoint or runId + runStateStore"
    );
  }
  const loaded = await Promise.resolve(store.get(runId));
  if (!loaded) {
    throw new SpecHostError(
      "checkpoint_not_found",
      `No checkpoint for runId ${JSON.stringify(runId)}`
    );
  }
  return loaded;
}

/**
 * Resume a Spec run paused at HITL (same process or after process restart).
 * Rebuilds engines from the checkpoint Spec + caller catalog/secrets.
 */
export async function resumeSpec(
  options: ResumeSpecOptions
): Promise<RunSpecResult> {
  const checkpoint = await loadCheckpoint(options);
  if (checkpoint.status !== "waiting_you") {
    throw new SpecHostError(
      "checkpoint_not_waiting",
      `Run ${checkpoint.runId} status is ${checkpoint.status}, expected waiting_you`
    );
  }

  const prepared = await prepareSpecRun({
    frozen: checkpoint.frozen,
    body: checkpoint.body,
    services: options.services,
    connectionStore: options.connectionStore,
    knownConnections: options.knownConnections,
    resolveConnection: options.resolveConnection,
    llmClient: options.llmClient,
    apiFixtures: options.apiFixtures,
    dryRun: options.dryRun ?? checkpoint.dryRun,
    blockNetwork: options.blockNetwork ?? checkpoint.blockNetwork,
    fetch: options.fetch,
    mode: checkpoint.mode,
    extraEngines: options.extraEngines,
    fallbackEngines: options.fallbackEngines,
    skipValidate: false,
    name: checkpoint.frozen.id,
  });

  const hitl = options.hitl ?? {};
  const autoApprove = hitl.autoApprove ?? false;
  const pauseAndReturn =
    hitl.pauseAndReturn ??
    (!autoApprove && !hitl.adapter && !hitl.onFeedbackRequested);

  const { runtime } = createWorkflowRuntime({
    lowered: prepared.lowered,
    engines: prepared.engines,
    context: cloneContext(checkpoint.context),
    assertRunnable: options.assertRunnable ?? false,
    softFailClosed: options.softFailClosed ?? true,
    runtimeOptions: {
      startAtStageIndex: checkpoint.stageIndex,
      pauseOnHitl: pauseAndReturn,
      pendingRequestId: checkpoint.pendingFeedback?.id,
    },
  });

  if (!checkpoint.pendingFeedback) {
    throw new SpecHostError(
      "checkpoint_missing_feedback",
      `Checkpoint ${checkpoint.runId} has no pendingFeedback`
    );
  }
  runtime.restoreWaitingUser(
    checkpoint.pendingFeedback,
    checkpoint.stageIndex
  );

  const feedback: FeedbackResponse = {
    requestId:
      options.feedback.requestId ??
      checkpoint.pendingFeedback?.id ??
      runtime.getPendingRequestId() ??
      "",
    agentId:
      options.feedback.agentId ??
      checkpoint.context.agentId ??
      "operator",
    action: options.feedback.action ?? "proceed",
    value: options.feedback.value,
  };

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
  }

  await runtime.resumeWithFeedback(feedback);
  broker?.detach();

  const ctx = runtime.getContext();
  const evidence = getEvidence(ctx);
  const stepOutputs = stepOutputsFromContext(ctx as Record<string, unknown>);
  const state = runtime.getState();

  const store = options.runStateStore ?? hitl.runStateStore;
  let nextCheckpoint: SpecRunCheckpoint | undefined;

  if (store) {
    // Keep checkpoint.specHash (hosts may re-key after live budget override so
    // Apps/Seats filters still match the installed Spec hash).
    nextCheckpoint = buildRunRecord({
      runId: checkpoint.runId,
      specId: prepared.frozen.id,
      specHash: checkpoint.specHash,
      mode: prepared.mode,
      status: statusFromRuntimeState(state),
      stageIndex: runtime.getCurrentStageIndex(),
      stageName:
        runtime.getActiveStages()[runtime.getCurrentStageIndex()]?.name ?? "",
      context: ctx,
      frozen: prepared.frozen,
      body: prepared.body,
      dryRun: prepared.dryRun,
      blockNetwork: prepared.blockNetwork,
      stepOutputs,
      pendingFeedback:
        state === "WAITING_USER"
          ? runtime.getPausedFeedbackRequest() ?? undefined
          : undefined,
      lastFeedback: feedback,
      previous: checkpoint,
    });
    nextCheckpoint = withEnqueuedOutcomeFollowUps(nextCheckpoint);
    await store.save(nextCheckpoint);
  }

  return {
    ok: state === "COMPLETE",
    state,
    specId: prepared.frozen.id,
    specHash: checkpoint.specHash,
    frozen: prepared.frozen,
    lowered: prepared.lowered,
    evidence,
    evidenceCount: evidence.length,
    stepOutputs,
    stageResults: (ctx.stageResults ?? {}) as Record<string, unknown>,
    mode: prepared.mode,
    dryRun: prepared.dryRun,
    blockNetwork: prepared.blockNetwork,
    simulatedWriteCount: countSimulatedWrites(stepOutputs),
    runId: checkpoint.runId,
    checkpoint: nextCheckpoint,
    pendingFeedback: nextCheckpoint?.pendingFeedback,
    runtime,
  };
}
