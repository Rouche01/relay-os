import { EngineType } from "./engines";
import { FeedbackType } from "./feedback";

/**
 * Named alternate pipeline on an {@link AgenticAppManifest}.
 * Root `stages` remain the default entrypoint body (backward compatible).
 */
export interface EntrypointDefinition {
  description: string;
  stages: StageDefinition[];
  /** Intent triggers for this pipeline; falls back to the manifest root triggers. */
  triggers?: IntentTrigger[];
}

export interface AgenticAppManifest {
  // Identity
  name: string;
  version: string;
  description: string;
  author: string;

  // Intent matching
  triggers: IntentTrigger[];

  // Capabilities & Requirements
  capabilities: string[];
  /** Engines the app needs. Omit `"none"` — HITL-only stages do not require a registered engine. */
  engines_required: EngineType[];
  engines_optional?: EngineType[];
  permissions: string[];

  // Workflow
  /** Default entrypoint body when no named entrypoint is selected. */
  stages: StageDefinition[];
  feedback_patterns: FeedbackType[];

  /**
   * Named alternate pipelines the host can start independently
   * (e.g. `post_watch` backlog drain). Host / AgentRuntime selects by name;
   * schedules (A2) reference these keys — runtime does not interpret cron.
   */
  entrypoints?: Record<string, EntrypointDefinition>;

  /**
   * Names of nested manifests this app composes (documentation / discovery).
   * Runtime nesting is declared per-stage via `StageDefinition.fanout`.
   */
  composes_with?: string[];
}

/** Conventional name for the root `stages` pipeline when listing entrypoints. */
export const DEFAULT_ENTRYPOINT = "default";

export interface ResolvedEntrypoint {
  /** `default` when using root `stages`, otherwise the map key. */
  name: string;
  description: string;
  stages: StageDefinition[];
  triggers: IntentTrigger[];
}

/**
 * Resolve which stage list a host should run.
 * Omit `entrypoint` (or pass {@link DEFAULT_ENTRYPOINT}) → root `stages`.
 * Named keys must exist on `manifest.entrypoints`.
 */
export function resolveEntrypoint(
  manifest: AgenticAppManifest,
  entrypoint?: string
): ResolvedEntrypoint {
  if (entrypoint == null || entrypoint === "" || entrypoint === DEFAULT_ENTRYPOINT) {
    return {
      name: DEFAULT_ENTRYPOINT,
      description: manifest.description,
      stages: manifest.stages,
      triggers: manifest.triggers,
    };
  }
  const ep = manifest.entrypoints?.[entrypoint];
  if (!ep) {
    const known = listEntrypointNames(manifest).join(", ");
    throw new Error(
      `Unknown entrypoint "${entrypoint}" on manifest "${manifest.name}" (known: ${known})`
    );
  }
  return {
    name: entrypoint,
    description: ep.description,
    stages: ep.stages,
    triggers: ep.triggers ?? manifest.triggers,
  };
}

/** Root default plus every key in `entrypoints` (discovery / admin). */
export function listEntrypointNames(manifest: AgenticAppManifest): string[] {
  return [DEFAULT_ENTRYPOINT, ...Object.keys(manifest.entrypoints ?? {})];
}

/**
 * Shallow project: same manifest identity, stages/triggers swapped for the
 * selected entrypoint. Useful for hosts that still pass a flat stages[] view.
 */
export function projectEntrypoint(
  manifest: AgenticAppManifest,
  entrypoint?: string
): AgenticAppManifest {
  const resolved = resolveEntrypoint(manifest, entrypoint);
  return {
    ...manifest,
    description: resolved.description,
    stages: resolved.stages,
    triggers: resolved.triggers,
  };
}

export interface IntentTrigger {
  pattern: string;
  description: string;
  examples: string[];
  confidence_threshold?: number;
}

/**
 * Expand one stage into N isolated child runtimes (one per work item).
 * Each child runs a flat nested manifest; a child abort/fail does not abort the parent.
 * v1: serial only — no recursive fanout inside children.
 */
export interface FanoutDefinition {
  /** Nested child manifest (inline). */
  manifest: AgenticAppManifest;
  /** Parent context key holding the work-items array. */
  from: string;
  /**
   * Child context key for the current item (default `"item"`).
   * Apps that need a domain name (e.g. `"opportunity"`) set this explicitly.
   */
  itemKey?: string;
  /** Max children this run. Omit = process every item in `from`. */
  max?: number;
  /** v1 supports serial only. */
  mode?: "serial";
  /** Pause between children (ms). */
  delay_ms?: number;
}

export interface StageDefinition {
  name: string;
  description: string;
  /**
   * Engine that runs this stage.
   * Use `"none"` for pure HITL gates and for fanout queue stages.
   */
  engine: EngineType;
  /**
   * When set, the runtime fans this stage out into one child AgentRuntime
   * per item in `context[fanout.from]`, each running `fanout.manifest`.
   */
  fanout?: FanoutDefinition;
  feedback_points?: FeedbackPoint[];
  timeout_ms?: number;
}

export interface FeedbackPoint {
  type: FeedbackType;
  description: string;
  /**
   * When false (e.g. `progress`), runtime may skip or auto-proceed
   * instead of waiting forever for a human.
   */
  required: boolean;
  /** Optional per-point timeout; falls back to stage / request default */
  timeout_ms?: number;
  /**
   * Static options for `choice` feedback.
   * Prefer AppController.buildFeedbackOptions when options are dynamic.
   */
  options?: string[];
}
