export type {
  PhoneActionMixPriors,
  PhoneDecideInput,
  PhoneDecider,
  PhoneDecision,
  PhoneDecisionKind,
  PhoneGoal,
  PhoneLoopOptions,
  PhoneLoopResult,
  PhoneObservation,
  PhoneObserveMode,
  PhoneProgressGuardContext,
  PhoneProgressGuardResult,
  PhoneStepRecord,
  PhoneTimingConfig,
  PhoneWaitDistribution,
} from "./types.js";

export {
  defaultPhoneTiming,
  sampleWaitMs,
  shouldExit,
} from "./timing.js";

export {
  buildPhoneSystemPrompt,
  buildPhoneUserPrompt,
} from "./prompt.js";

export {
  createLlmPhoneDecider,
  createScriptedPhoneDecider,
  normalizeDecisionKind,
  parseDecision,
} from "./decide.js";

export {
  launchApp,
  launchPackage,
  openUri,
  type PhoneLaunchResult,
} from "./launch.js";

export { runPhonePolicyLoop } from "./loop.js";

export {
  createTelegramPhaseProgressGuard,
  DEFAULT_TELEGRAM_PHASE_BUDGETS,
  observationTextBlob,
  telegramDogfoodPhase,
  type TelegramDogfoodPhase,
  type TelegramPhaseProgressGuardOptions,
  type TelegramPhaseProgressInfo,
} from "./dogfood-phases.js";

export {
  phoneGoalTask,
  type PhoneGoalTaskOptions,
} from "./phone-goal-task.js";
