import type {
  AgentContext,
  ExecutionEngine,
  FeedbackResponse,
} from "@relay/protocol";
import type { AgentRuntimeOptions, AppController } from "@relay/runtime";
import type { LoweredWorkflow } from "@relay/spec-lower";

/** One evidence trail entry recorded during a Spec v2 run. */
export type WorkflowEvidenceEntry = {
  at: string;
  stepId: string;
  kind: "execute" | "enforce" | "hitl" | "fanout" | "error" | "skip";
  detail: Record<string, unknown>;
};

/** Context bag shape the interpreter maintains under AgentContext. */
export type WorkflowStepsBag = Record<
  string,
  { output: unknown; feedback?: FeedbackResponse }
>;

export type WorkflowControllerOptions = {
  lowered: LoweredWorkflow;
  getContext: () => AgentContext;
  /**
   * Full engine map (for soft-rule `llm.judge` when the stage engine is not llm).
   */
  engines?: Record<string, ExecutionEngine>;
  /**
   * When true (default), soft rules listed in `enforce` fail closed if they
   * cannot be evaluated (no llm engine).
   */
  softFailClosed?: boolean;
};

export type CreateWorkflowRuntimeOptions = {
  lowered: LoweredWorkflow;
  engines: Record<string, ExecutionEngine>;
  context: AgentContext;
  /**
   * Assert hash / structure before run (default true).
   * Pass `{ validate: true }` to also re-validate Spec v2.
   */
  assertRunnable?: boolean | { validate?: boolean };
  softFailClosed?: boolean;
  /** Forwarded to AgentRuntime (pauseOnHitl, startAtStageIndex, …). */
  runtimeOptions?: AgentRuntimeOptions;
  /**
   * Optional decorator around WorkflowController (and fanout children).
   * Use to opt in autonomous handlers (e.g. computer.browse) without
   * replacing declarative Spec execution for other steps.
   * `helpers.getContext` is safe to close over — it resolves after runtime init.
   */
  decorateController?: (
    base: AppController,
    helpers: { getContext: () => AgentContext }
  ) => AppController;
};
