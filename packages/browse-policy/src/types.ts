import type {
  SeatDecideInput,
  SeatDecider,
  SeatDecision,
  SeatDecisionKind,
  SeatLoopResult,
  SeatObservation,
  SeatStepRecord,
  SeatTimingConfig,
  SeatWaitDistribution,
} from "@relay/computer-seat-policy";

export type BrowseWaitDistribution = SeatWaitDistribution;

export type BrowseTimingConfig = SeatTimingConfig;

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

export type BrowseObservation = SeatObservation;

export type BrowseDecisionKind = SeatDecisionKind;

export type BrowseDecision = SeatDecision;

export type BrowseStepRecord = SeatStepRecord;

export type BrowseLoopResult = SeatLoopResult;

export type BrowseDecideInput = SeatDecideInput<BrowseGoal>;

export type BrowseDecider = SeatDecider<BrowseGoal>;

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
