import type { AgentContext, ExecutionEngine } from "@relay/protocol";
import { assertLoweredRunnable, type LoweredWorkflow } from "@relay/spec-lower";
import { AgentRuntime } from "@relay/runtime";
import { WorkflowController } from "./controller.js";
import { WorkflowFanoutHost } from "./fanout-host.js";
import type { CreateWorkflowRuntimeOptions } from "./types.js";

export type WorkflowRuntimeBundle = {
  runtime: AgentRuntime;
  controller: WorkflowController;
  fanoutHost: WorkflowFanoutHost;
  lowered: LoweredWorkflow;
};

/**
 * Bind a lowered Spec v2 workflow to AgentRuntime + generic interpreter.
 * Calls assertLoweredRunnable unless `assertRunnable: false`.
 */
export function createWorkflowRuntime(
  options: CreateWorkflowRuntimeOptions
): WorkflowRuntimeBundle {
  const { lowered, engines, context } = options;

  if (options.assertRunnable !== false) {
    const liftOpts =
      typeof options.assertRunnable === "object"
        ? options.assertRunnable
        : { validate: false };
    assertLoweredRunnable(lowered, liftOpts);
  }

  const ref: { runtime?: AgentRuntime } = {};
  const softFailClosed = options.softFailClosed ?? true;

  const controller = new WorkflowController({
    lowered,
    getContext: () => {
      if (!ref.runtime) {
        throw new Error("Workflow runtime accessed before initialisation");
      }
      return ref.runtime.getContext();
    },
    engines,
    softFailClosed,
  });

  const fanoutHost = new WorkflowFanoutHost({
    lowered,
    getParentContext: () => {
      if (!ref.runtime) {
        throw new Error("Workflow runtime accessed before initialisation");
      }
      return ref.runtime.getContext();
    },
    engines,
    softFailClosed,
  });

  const runtime = new AgentRuntime(
    lowered.manifest,
    engines,
    ensureStepsBag(context),
    controller,
    fanoutHost
  );
  ref.runtime = runtime;

  return { runtime, controller, fanoutHost, lowered };
}

function ensureStepsBag(context: AgentContext): AgentContext {
  return {
    ...context,
    steps: context.steps ?? {},
    stageResults: { ...(context.stageResults ?? {}) },
    evidence: Array.isArray(context.evidence) ? [...context.evidence] : [],
  };
}

/** Convenience re-export for hosts wiring engines. */
export type { ExecutionEngine };
