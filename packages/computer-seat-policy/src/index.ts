/**
 * `@relay/computer-seat-policy` — thin shim over published `@useapron/seat`.
 *
 * Prefer `@useapron/seat` in new code. Prompts / LLM deciders stay in
 * `@relay/browse-policy` and `@relay/phone-policy`.
 */
export type {
  CaptureObservationResult,
  SeatDecideInput,
  SeatDecider,
  SeatDecision,
  SeatDecisionKind,
  SeatGoalBase,
  SeatLoopOptions,
  SeatLoopResult,
  SeatObservation,
  SeatProgressGuardContext,
  SeatProgressGuardResult,
  SeatStepRecord,
  SeatTimingConfig,
  SeatWaitDistribution,
} from "@useapron/seat";

export {
  actionFingerprint,
  captureObserveObservation,
  captureScreenshotObservation,
  defaultScreenSignature,
  defaultSeatTiming,
  runSeatPolicyLoop,
  sampleWaitMs,
  shouldExit,
} from "@useapron/seat";
