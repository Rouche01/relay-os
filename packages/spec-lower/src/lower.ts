import {
  catalogEngineToEngineType,
  classifySpecV2Trigger,
  DEFAULT_ENTRYPOINT,
  getCapability,
  outcomeScheduleId,
  parseCapabilityUse,
  parseDurationMs,
  parseSpecV2Ref,
  SPEC_V2_ESCALATE_FEEDBACK_PREFIX,
  SPEC_V2_SCHEDULE_ID,
  type AgenticAppManifest,
  type EngineType,
  type EntrypointDefinition,
  type FeedbackPoint,
  type FeedbackType,
  type ScheduleDefinition,
  type SpecV2Body,
  type SpecV2OutcomeRule,
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

  const triggerSchedules = schedulesFromTrigger(body) ?? [];
  const outcome = schedulesAndEntrypointsFromOutcomeRules(body);
  const schedules = [...triggerSchedules, ...outcome.schedules];

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
    ...(Object.keys(outcome.entrypoints).length
      ? { entrypoints: outcome.entrypoints }
      : {}),
    ...(schedules.length ? { schedules } : {}),
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
    trigger: body.trigger,
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
      trigger: body.trigger,
      budget: body.budget,
      rules: body.rules,
      steps: body.steps,
    },
    specRecord: options.specRecord,
    relay,
    manifest,
  };
}

/** Lower Spec v2.1 trigger → manifest schedules (empty when manual / absent). */
export function schedulesFromTrigger(
  body: Pick<SpecV2Body, "trigger" | "goal">
): ScheduleDefinition[] | undefined {
  if (!body.trigger) return undefined;
  const classified = classifySpecV2Trigger(body.trigger);
  if (classified.kind === "manual") return undefined;
  if (classified.kind === "schedule") {
    return [
      {
        id: SPEC_V2_SCHEDULE_ID,
        entrypoint: DEFAULT_ENTRYPOINT,
        cron: classified.cron,
        enabled: true,
        description: `Spec schedule ${classified.cron}${
          classified.timezone ? ` (${classified.timezone})` : ""
        }`,
      },
    ];
  }
  return [
    {
      id: SPEC_V2_SCHEDULE_ID,
      entrypoint: DEFAULT_ENTRYPOINT,
      every_ms: classified.everyMs,
      enabled: true,
      description: `Spec poll every ${classified.everyMs}ms (source: ${classified.sourceStep})`,
    },
  ];
}

/**
 * Lower Spec outcome rules → named entrypoints + every_ms schedules.
 * Hosts invoke these entrypoints to measure deferred metrics (not root stages).
 */
export function schedulesAndEntrypointsFromOutcomeRules(
  body: Pick<SpecV2Body, "rules">
): {
  schedules: ScheduleDefinition[];
  entrypoints: Record<string, EntrypointDefinition>;
} {
  const schedules: ScheduleDefinition[] = [];
  const entrypoints: Record<string, EntrypointDefinition> = {};
  for (const rule of body.rules ?? []) {
    if (rule.kind !== "outcome") continue;
    const outcomeRule = rule as SpecV2OutcomeRule;
    const id = outcomeScheduleId(outcomeRule.id);
    let afterMs: number;
    try {
      afterMs = parseDurationMs(outcomeRule.metric.after);
    } catch {
      // Validator owns fail-closed; skip malformed here so lower stays pure.
      continue;
    }
    entrypoints[id] = {
      description: `Outcome follow-up: ${outcomeRule.metric.name} after ${outcomeRule.metric.after}`,
      stages: [
        {
          name: id,
          description: `Measure ${outcomeRule.metric.name} (rule ${outcomeRule.id})`,
          engine: "none",
        },
      ],
    };
    schedules.push({
      id,
      entrypoint: id,
      every_ms: afterMs,
      enabled: true,
      description: `Outcome ${outcomeRule.id} · ${outcomeRule.metric.name} · ${outcomeRule.metric.after}`,
    });
  }
  return { schedules, entrypoints };
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

  const feedback = mergeStepFeedback(step, feedbackPatterns);
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

/** Human.* feedback plus optional onError escalate confirmation. */
function mergeStepFeedback(
  step: SpecV2Step,
  patterns: Set<FeedbackType>
): FeedbackPoint[] | undefined {
  const human = humanFeedback(step, patterns) ?? [];
  const escalate =
    step.onError === "escalate_human"
      ? escalateFeedback(step, patterns)
      : [];
  const merged = [...human, ...escalate];
  return merged.length ? merged : undefined;
}

function escalateFeedback(
  step: SpecV2Step,
  patterns: Set<FeedbackType>
): FeedbackPoint[] {
  patterns.add("confirmation");
  return [
    {
      type: "confirmation",
      description: `${SPEC_V2_ESCALATE_FEEDBACK_PREFIX} Step ${step.id} failed — Approve to skip, Abort to fail`,
      required: true,
    },
  ];
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
