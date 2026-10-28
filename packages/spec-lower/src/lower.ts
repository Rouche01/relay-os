import {
  catalogEngineToEngineType,
  getCapability,
  parseCapabilityUse,
  parseSpecV2Ref,
  type AgenticAppManifest,
  type EngineType,
  type FeedbackPoint,
  type FeedbackType,
  type SpecV2Body,
  type SpecV2Step,
  type StageDefinition,
} from "@relay/protocol";
import { hashSpecV2 } from "./hash.js";
import type {
  LoweredWorkflow,
  LowerSpecV2Options,
  RelayStepsBlock,
} from "./types.js";
import { LOWERED_WORKFLOW_KIND } from "./types.js";

/**
 * Deterministically lower a Spec v2 body to an AgenticAppManifest + relay block.
 * Does not validate — call validateSpecV2 before freeze/lower in hosts.
 */
export function lowerSpecV2(
  body: SpecV2Body,
  options: LowerSpecV2Options = {}
): LoweredWorkflow {
  const specHash = hashSpecV2(body);
  const foreachFrom: Record<string, string> = {};
  const stages: StageDefinition[] = [];
  const engines = new Set<EngineType>();
  const feedbackPatterns = new Set<FeedbackType>();

  for (const step of body.steps) {
    const stage = lowerStep(step, body, foreachFrom, engines, feedbackPatterns);
    stages.push(stage);
  }

  const name =
    options.name?.trim() ||
    slugify(body.goal).slice(0, 48) ||
    "relay-workflow";

  const manifest: AgenticAppManifest = {
    name,
    version: options.version ?? "0.1.0",
    description: body.goal,
    author: options.author ?? "Relay Spec v2",
    triggers: [
      {
        pattern: body.goal.slice(0, 80),
        description: body.goal,
        examples: [body.goal.slice(0, 80)],
      },
    ],
    capabilities: collectCapabilities(body.steps),
    engines_required: [...engines],
    permissions: [],
    stages,
    feedback_patterns: [...feedbackPatterns],
  };

  const relay: RelayStepsBlock = {
    specHash,
    specId: options.specId ?? options.specRecord?.id,
    goal: body.goal,
    budget: body.budget,
    rules: body.rules ?? [],
    steps: body.steps,
    connections: body.connections,
    services: body.services,
    foreachFrom,
  };

  return {
    kind: LOWERED_WORKFLOW_KIND,
    version: 1,
    specHash,
    spec: {
      goal: body.goal,
      connections: body.connections,
      services: body.services,
      budget: body.budget,
      rules: body.rules,
      steps: body.steps,
    },
    specRecord: options.specRecord,
    relay,
    manifest,
  };
}

function lowerStep(
  step: SpecV2Step,
  body: SpecV2Body,
  foreachFrom: Record<string, string>,
  engines: Set<EngineType>,
  feedbackPatterns: Set<FeedbackType>
): StageDefinition {
  const parsed = parseCapabilityUse(step.use);
  const capability = parsed.ok ? parsed.capability : getCapability(step.use);
  const engineType = capability
    ? catalogEngineToEngineType(capability.engine)
    : "none";

  if (engineType !== "none") {
    engines.add(engineType);
  }

  const feedback = humanFeedback(step, feedbackPatterns);
  const description =
    capability?.description ??
    step.use + (step.forEach ? ` (forEach)` : "");

  if (step.forEach) {
    const refPath = parseSpecV2Ref(step.forEach) ?? step.forEach;
    foreachFrom[step.id] = refPath;

    const childEngine = engineType === "none" ? "none" : engineType;
    if (childEngine !== "none") engines.add(childEngine);

    const childStage: StageDefinition = {
      name: step.id,
      description,
      engine: childEngine,
      feedback_points: feedback,
    };

    const childManifest: AgenticAppManifest = {
      name: `${step.id}_item`,
      version: "0.1.0",
      description: `Fanout item for ${step.id}`,
      author: "Relay Spec v2",
      triggers: [],
      capabilities: [step.use],
      engines_required: childEngine === "none" ? [] : [childEngine],
      permissions: [],
      stages: [childStage],
      feedback_patterns: feedback?.map((f) => f.type) ?? [],
    };

    return {
      name: step.id,
      description: `Fanout: ${description}`,
      engine: "none",
      fanout: {
        manifest: childManifest,
        from: foreachContextKey(step.id),
        itemKey: "item",
        max: body.budget?.maxJobs,
        mode: "serial",
      },
    };
  }

  return {
    name: step.id,
    description,
    engine: engineType,
    feedback_points: feedback,
  };
}

/** Context key the workflow runtime fills before running a forEach stage. */
export function foreachContextKey(stepId: string): string {
  return `__relay.foreach.${stepId}`;
}

function humanFeedback(
  step: SpecV2Step,
  patterns: Set<FeedbackType>
): FeedbackPoint[] | undefined {
  const parsed = parseCapabilityUse(step.use);
  if (!parsed.ok || parsed.capability.engine !== "human") return undefined;

  const verb = parsed.capability.verb;
  if (verb === "approve") {
    patterns.add("approval");
    return [
      {
        type: "approval",
        description:
          typeof step.args?.prompt === "string"
            ? step.args.prompt
            : "Approve / Abort before continuing",
        required: true,
      },
    ];
  }
  if (verb === "edit") {
    patterns.add("freeform");
    return [
      {
        type: "freeform",
        description:
          typeof step.args?.prompt === "string"
            ? step.args.prompt
            : "Edit the artifact, or abort",
        required: true,
      },
    ];
  }
  if (verb === "choose") {
    patterns.add("choice");
    const options = Array.isArray(step.args?.options)
      ? step.args.options.map((o) => String(o))
      : undefined;
    return [
      {
        type: "choice",
        description:
          typeof step.args?.prompt === "string"
            ? step.args.prompt
            : "Choose an option",
        required: true,
        options,
      },
    ];
  }
  return undefined;
}

function collectCapabilities(steps: SpecV2Step[]): string[] {
  return [...new Set(steps.map((s) => s.use))];
}

function slugify(goal: string): string {
  return goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
