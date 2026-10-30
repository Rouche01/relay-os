import type {
  AgenticAppManifest,
  SpecV2,
  SpecV2Body,
} from "@relay/protocol";

/** Envelope kind for lowered Spec v2 workflows. */
export const LOWERED_WORKFLOW_KIND = "relay.spec.v2" as const;

/**
 * Interpreter metadata parallel to manifest.stages.
 * Stages[i] corresponds to steps[i] for linear steps; forEach steps use fanout.
 */
export type RelayStepsBlock = {
  specHash: string;
  specId?: string;
  goal: string;
  budget?: SpecV2Body["budget"];
  rules: NonNullable<SpecV2Body["rules"]>;
  steps: SpecV2Body["steps"];
  connections?: string[];
  services?: string[];
  /** Spec v2.1 trigger (manual | schedule | poll). */
  trigger?: SpecV2Body["trigger"];
  /**
   * Context keys the runtime must populate before a fanout stage.
   * Key = stage name (step id); value = forEach ref path (without ${}).
   */
  foreachFrom: Record<string, string>;
};

export type LoweredWorkflow = {
  kind: typeof LOWERED_WORKFLOW_KIND;
  version: 1;
  specHash: string;
  /** Authoring body that produced the manifest (source of truth for hash). */
  spec: SpecV2Body;
  /** Optional lifecycle Spec when lowered from a frozen SpecV2. */
  specRecord?: Pick<SpecV2, "id" | "version" | "status" | "intentId">;
  relay: RelayStepsBlock;
  manifest: AgenticAppManifest;
};

export type LowerSpecV2Options = {
  /** Manifest name (default: slug from goal or "relay-workflow"). */
  name?: string;
  version?: string;
  author?: string;
  specId?: string;
  specRecord?: LoweredWorkflow["specRecord"];
};
