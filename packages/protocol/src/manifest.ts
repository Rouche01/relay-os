import { EngineType } from "./engines";
import { FeedbackType } from "./feedback";

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
  stages: StageDefinition[];
  feedback_patterns: FeedbackType[];

  /**
   * Names of nested manifests this app composes (documentation / discovery).
   * Runtime nesting is declared per-stage via `StageDefinition.fanout`.
   */
  composes_with?: string[];
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
}
