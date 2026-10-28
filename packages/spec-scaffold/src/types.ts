import type { LlmClient } from "@relay/llm";
import type { ServiceDescriptor, SpecV2Body } from "@relay/protocol";
import type {
  SpecV2ValidationIssue,
  SpecV2ValidationResult,
  ValidateSpecV2Options,
} from "@relay/spec-validator";

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
   */
  maxRepairs?: number;
  temperature?: number;
  /** Extra validate options merged over services/knownConnections. */
  validate?: ValidateSpecV2Options;
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
    };
