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
  engine: EngineType;
  feedback_points?: FeedbackPoint[];
  timeout_ms?: number;
}

export interface FeedbackPoint {
  type: FeedbackType;
  description: string;
  required: boolean;
}
