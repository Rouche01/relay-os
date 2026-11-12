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

export type PhoneWaitDistribution = SeatWaitDistribution;
export type PhoneTimingConfig = SeatTimingConfig;

/** How each loop iteration captures the screen. Default for phone: `"observe"`. */
export type PhoneObserveMode = "screenshot" | "observe";

export interface PhoneActionMixPriors {
  click?: number;
  swipe?: number;
  long_press?: number;
  launch?: number;
  key?: number;
  type?: number;
  scroll?: number;
  move?: number;
}

export interface PhoneGoal {
  text: string;
  /**
   * Optional start: Android package name and/or am-start uri.
   * Prefer `launchPackage` / fields over Firefox-style startUrl.
   */
  package?: string;
  uri?: string;
  /** Soft priors injected into the prompt (not hard scripts). */
  actionMix?: PhoneActionMixPriors;
  allowedActions?: string[];
}

export type PhoneObservation = SeatObservation;
export type PhoneDecisionKind = SeatDecisionKind;
export type PhoneDecision = SeatDecision;
export type PhoneStepRecord = SeatStepRecord;
export type PhoneLoopResult = SeatLoopResult;
export type PhoneDecideInput = SeatDecideInput<PhoneGoal>;
export type PhoneDecider = SeatDecider<PhoneGoal>;

export interface PhoneLoopOptions {
  goal: PhoneGoal;
  timing: PhoneTimingConfig;
  decide: PhoneDecider;
  maxIterations?: number;
  /** Settle after launch / package open (default 2000). */
  launchSettleMs?: number;
  /**
   * Extra settle after swipe / long_press / launch during the loop (default 450).
   */
  swipeSettleMs?: number;
  /**
   * Default `"observe"` (screenshot + UIAutomator elements).
   */
  observeMode?: PhoneObserveMode;
  /** Cap elements when observeMode is observe (gateway default 200). */
  maxElements?: number;
  heartbeatEachIteration?: boolean;
  recycle?: boolean;
  reuseSession?: boolean;
  jobId?: string;
  agentId?: string;
  ttlSec?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onObservation?: (
    observation: PhoneObservation,
    iteration: number
  ) => Promise<string | void> | string | void;
}
