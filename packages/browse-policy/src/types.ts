import type { ComputerActionPayload } from "@relay/engines-computer";

export type BrowseWaitDistribution = "exponential" | "lognormal";

export interface BrowseTimingConfig {
  /** Rate λ for Exp(λ) inter-action waits (mean ≈ 1/λ seconds when unit is seconds). */
  actionRateLambda: number;
  /** Per-step probability of ending the session (exit hazard). */
  exitRateMu: number;
  minMs: number;
  maxMs: number;
  distribution?: BrowseWaitDistribution;
  /**
   * Lognormal σ (log-space). Mean of underlying normal is derived so E[T] ≈ 1/λ
   * when distribution is lognormal.
   */
  lognormalSigma?: number;
}

export interface BrowseActionMixPriors {
  click?: number;
  scroll?: number;
  type?: number;
  key?: number;
  move?: number;
}

export interface BrowseGoal {
  text: string;
  startUrl?: string;
  allowedActions?: string[];
  /** Soft priors injected into the prompt (not hard scripts). */
  actionMix?: BrowseActionMixPriors;
}

export interface BrowseObservation {
  imageBase64: string;
  at: string;
  meta?: Record<string, unknown>;
}

export type BrowseDecisionKind = "act" | "done" | "need_human";

export interface BrowseDecision {
  kind: BrowseDecisionKind;
  reason?: string;
  /** Required when kind === "act" */
  action?: ComputerActionPayload;
}

export interface BrowseStepRecord {
  iteration: number;
  waitedMs: number;
  observationAt: string;
  decision: BrowseDecision;
  actionOk?: boolean;
  actionError?: string;
}

export interface BrowseLoopResult {
  success: boolean;
  stoppedReason:
    | "done"
    | "need_human"
    | "exit_hazard"
    | "max_iterations"
    | "error";
  error?: string;
  steps: BrowseStepRecord[];
  vncUrl?: string;
  evidencePaths?: string[];
}

export interface BrowseDecideInput {
  goal: BrowseGoal;
  observation: BrowseObservation;
  history: BrowseStepRecord[];
  iteration: number;
  maxIterations: number;
}

export interface BrowseDecider {
  decide(input: BrowseDecideInput): Promise<BrowseDecision>;
}

export interface BrowseLoopOptions {
  goal: BrowseGoal;
  timing: BrowseTimingConfig;
  decide: BrowseDecider;
  maxIterations?: number;
  /** Navigate settle ms after startUrl (default 2000). */
  navigateSettleMs?: number;
  /** Heartbeat once per iteration (default true). */
  heartbeatEachIteration?: boolean;
  /** Soft-park when finished (default). Set recycle: true to wipe. */
  recycle?: boolean;
  /** Skip lease if already leased. */
  reuseSession?: boolean;
  jobId?: string;
  agentId?: string;
  ttlSec?: number;
  /** Inject for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Inject for tests. */
  random?: () => number;
  /** Called after each screenshot (e.g. write PNG evidence). */
  onObservation?: (
    observation: BrowseObservation,
    iteration: number
  ) => Promise<string | void> | string | void;
}
