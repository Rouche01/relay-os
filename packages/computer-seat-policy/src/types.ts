import type {
  ComputerActionPayload,
  ComputerObserveElement,
  ComputerSeatKind,
} from "@relay/engines-computer";

export type SeatWaitDistribution = "exponential" | "lognormal";

export interface SeatTimingConfig {
  /** Rate λ for Exp(λ) inter-action waits (mean ≈ 1/λ seconds when unit is seconds). */
  actionRateLambda: number;
  /** Per-step probability of ending the session (exit hazard). */
  exitRateMu: number;
  minMs: number;
  maxMs: number;
  distribution?: SeatWaitDistribution;
  /**
   * Lognormal σ (log-space). Mean of underlying normal is derived so E[T] ≈ 1/λ
   * when distribution is lognormal.
   */
  lognormalSigma?: number;
}

export interface SeatObservation {
  imageBase64: string;
  at: string;
  /** Present when capture used UIAutomator observe. */
  elements?: ComputerObserveElement[];
  meta?: Record<string, unknown>;
}

export type SeatDecisionKind = "act" | "done" | "need_human";

export interface SeatDecision {
  kind: SeatDecisionKind;
  reason?: string;
  /** Required when kind === "act" */
  action?: ComputerActionPayload;
}

export interface SeatStepRecord {
  iteration: number;
  waitedMs: number;
  observationAt: string;
  decision: SeatDecision;
  actionOk?: boolean;
  actionError?: string;
}

export interface SeatLoopResult {
  success: boolean;
  stoppedReason:
    | "done"
    | "need_human"
    | "exit_hazard"
    | "max_iterations"
    | "error";
  error?: string;
  steps: SeatStepRecord[];
  vncUrl?: string;
  evidencePaths?: string[];
}

/** Minimal goal shape required by the shared loop. */
export interface SeatGoalBase {
  text: string;
  allowedActions?: string[];
}

export interface SeatDecideInput<G extends SeatGoalBase = SeatGoalBase> {
  goal: G;
  observation: SeatObservation;
  history: SeatStepRecord[];
  iteration: number;
  maxIterations: number;
}

export interface SeatDecider<G extends SeatGoalBase = SeatGoalBase> {
  decide(input: SeatDecideInput<G>): Promise<SeatDecision>;
}

export type CaptureObservationResult =
  | { ok: true; observation: SeatObservation }
  | { ok: false; error: string };

export interface SeatLoopOptions<G extends SeatGoalBase = SeatGoalBase> {
  goal: G;
  timing: SeatTimingConfig;
  decide: SeatDecider<G>;
  /**
   * Capture screen (and optional element tree) for one iteration.
   * Callers supply screenshot vs observe.
   */
  captureObservation: (args: {
    iteration: number;
  }) => Promise<CaptureObservationResult>;
  /**
   * Optional setup after lease (navigate, launch package, etc.).
   */
  beforeLoop?: () => Promise<{ success: boolean; error?: string }>;
  /**
   * Optional settle after a successful act (swipe settle, etc.).
   */
  settleAfterAction?: (action: ComputerActionPayload) => Promise<void>;
  /**
   * Passed on lease when starting a new session (`"phone"` | `"desktop"`).
   * Omit for gateway default (desktop).
   */
  leaseKind?: ComputerSeatKind;
  maxIterations?: number;
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
  /** Called after each observation (e.g. write PNG evidence). */
  onObservation?: (
    observation: SeatObservation,
    iteration: number
  ) => Promise<string | void> | string | void;
}
