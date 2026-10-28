import type {
  AgentContext,
  ExecutionEngine,
  StageDefinition,
} from "@relay/protocol";
import type { LoweredWorkflow } from "@relay/spec-lower";
import type { AgentRuntime, AppController, FanoutHost } from "@relay/runtime";
import { WorkflowController } from "./controller.js";
import type { WorkflowStepsBag } from "./types.js";

export type WorkflowFanoutHostOptions = {
  lowered: LoweredWorkflow;
  /** Parent AgentContext accessor (to copy steps into children + collect outputs). */
  getParentContext: () => AgentContext;
  engines?: Record<string, ExecutionEngine>;
  softFailClosed?: boolean;
};

/**
 * FanoutHost that spawns WorkflowController children and folds child outputs
 * back onto the parent `steps.<stageId>.output` array.
 */
export class WorkflowFanoutHost implements FanoutHost {
  private readonly lowered: LoweredWorkflow;
  private readonly getParentContext: () => AgentContext;
  private readonly engines: Record<string, ExecutionEngine>;
  private readonly softFailClosed: boolean;
  private readonly childOutputs = new Map<string, unknown[]>();

  constructor(options: WorkflowFanoutHostOptions) {
    this.lowered = options.lowered;
    this.getParentContext = options.getParentContext;
    this.engines = options.engines ?? {};
    this.softFailClosed = options.softFailClosed ?? true;
  }

  createChildController(
    _stage: StageDefinition,
    _item: unknown,
    _index: number,
    getContext: () => AgentContext
  ): AppController {
    return new WorkflowController({
      lowered: this.lowered,
      getContext,
      engines: this.engines,
      softFailClosed: this.softFailClosed,
    });
  }

  async onChildStart(
    child: AgentRuntime,
    _item: unknown,
    _index: number
  ): Promise<void> {
    const parent = this.getParentContext();
    const childCtx = child.getContext();
    // Prior parent step outputs available to child refs (${steps.scout...}).
    if (parent.steps && typeof parent.steps === "object") {
      childCtx.steps = structuredClone(parent.steps) as WorkflowStepsBag;
    }
    if (Array.isArray(parent.evidence)) {
      childCtx.evidence = [...(parent.evidence as unknown[])];
    }
  }

  async onChildEnd(
    child: AgentRuntime,
    _item: unknown,
    _index: number
  ): Promise<void> {
    const parent = this.getParentContext();
    const childCtx = child.getContext();
    const stageName = child.getActiveStages()[0]?.name;
    if (!stageName) return;

    const bag = (childCtx.steps as WorkflowStepsBag | undefined)?.[stageName];
    const output = bag?.output;

    let list = this.childOutputs.get(stageName);
    if (!list) {
      list = [];
      this.childOutputs.set(stageName, list);
    }
    list.push(output);

    if (!parent.steps || typeof parent.steps !== "object") {
      parent.steps = {} as WorkflowStepsBag;
    }
    (parent.steps as WorkflowStepsBag)[stageName] = {
      output: [...list],
    };

    // Merge child evidence into parent.
    if (Array.isArray(childCtx.evidence)) {
      const parentEv = Array.isArray(parent.evidence)
        ? (parent.evidence as unknown[])
        : [];
      parent.evidence = [...parentEv, ...(childCtx.evidence as unknown[])];
    }
  }

  resolveFanoutConfig(stage: StageDefinition): {
    max?: number;
    delayMs?: number;
  } {
    const max = this.lowered.relay.budget?.maxJobs;
    return {
      max: typeof max === "number" ? max : stage.fanout?.max,
    };
  }
}
