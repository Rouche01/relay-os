/**
 * `@relay/engines-computer` — thin shim over published `@useapron/client`.
 *
 * Prefer importing `@useapron/client` directly in new code. This package keeps
 * existing `@relay/engines-computer` imports working and adds an optional
 * ExecutionEngine adapter for `@relay/protocol` bind sites.
 */
export {
  claimPhoneSeat,
  type ClaimPhoneSeatOptions,
  ComputerEngine,
  type ComputerEngineOptions,
  ComputerTaskRunner,
  type ComputerTaskRunnerOptions,
  builtinComputerTasks,
  captureFrameTask,
  openUrlTask,
  tourUrlsTask,
  navigateToUrl,
} from "@useapron/client";

export type {
  ComputerActionPayload,
  ComputerActionParams,
  ComputerActionType,
  ComputerEngineAction,
  ComputerLeaseInfo,
  ComputerLeaseParams,
  ComputerObserveElement,
  ComputerObserveResult,
  ComputerResult,
  ComputerSeatKind,
  ComputerTask,
  ComputerTaskContext,
  ComputerTaskResult,
  ComputerTaskRunOptions,
  ComputerTaskSession,
  GatewaySeat,
} from "@useapron/client";

export { toEngineResult, toExecutionEngine } from "./execution-engine.js";
