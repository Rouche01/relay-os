import type { LlmClient } from "@relay/llm";
import type { ServiceDescriptor, SpecV2Body } from "@relay/protocol";
import type {
  SpecV2ValidationIssue,
  SpecV2ValidationResult,
  ValidateSpecV2Options,
} from "@relay/spec-validator";
import type { ScaffoldNeed } from "./needs.js";

export type { ScaffoldNeed, ScaffoldNeedAction, ScaffoldNeedKind } from "./needs.js";

export type ScaffoldSpecOptions = {
  /** Plain-language intent / goal (markdown or prose). */
  intent: string;
  client: LlmClient;
  /** Service descriptors available to api.request (prompt + validate). */
  services?: readonly ServiceDescriptor[];
  /** Connection ids the operator has configured. */
  knownConnections?: readonly string[];
  /**
   * How many times to feed validator errors back to the model after the
   * initial draft (default 3). Total attempts = 1 + maxRepairs.
   * Skipped entirely when a capability gap (`needs`) is detected.
   */
  maxRepairs?: number;
  temperature?: number;
  /** Extra validate options merged over services/knownConnections. */
  validate?: ValidateSpecV2Options;
  /**
   * When true (default), skip the LLM if intent preflight finds missing
   * services/connections.
   */
  preflightNeeds?: boolean;
};

export type ScaffoldAttempt = {
  attempt: number;
  /** 1 = initial draft; >1 = repair. */
  kind: "draft" | "repair";
  body?: SpecV2Body;
  validation?: SpecV2ValidationResult;
  parseError?: string;
};

export type ScaffoldResult =
  | {
      ok: true;
      body: SpecV2Body;
      yaml: string;
      attempts: number;
      validation: SpecV2ValidationResult;
      history: ScaffoldAttempt[];
    }
  | {
      ok: false;
      attempts: number;
      lastBody?: SpecV2Body;
      yaml?: string;
      errors: SpecV2ValidationIssue[];
      history: ScaffoldAttempt[];
      message: string;
      /**
       * Capability gaps — import descriptor / add connection / expand ops.
       * When set, repair loop was skipped or aborted.
       */
      needs?: ScaffoldNeed[];
    };
