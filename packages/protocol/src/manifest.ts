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

  // Composition
  composes_with?: string[];
}

export interface IntentTrigger {
  pattern: string;
  description: string;
  examples: string[];
  confidence_threshold?: number;
}

export interface StageDefinition {
  name: string;
  description: string;
  /**
   * Engine that runs this stage.
   * Use `"none"` for pure HITL gates (await_approval) — feedback only, no execute.
   */
  engine: EngineType;
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
