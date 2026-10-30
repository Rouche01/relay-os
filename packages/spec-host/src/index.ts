export { SpecHostError, isSpecHostError } from "./errors.js";
export { buildSpecEngines } from "./engines.js";
export { resolveHostDefaults } from "./modes.js";
export {
  assertModeAllowed,
  countSimulatedWrites,
} from "./modes.js";
export {
  createLiveLlmClient,
  resolveRunLlmClient,
  tryCreateLiveLlmClient,
} from "./llm-client.js";
export { selectServicesForSpec } from "./services.js";
/** Curated descriptor pack — re-exported for Desk / hosts. */
export {
  CURATED_SERVICE_IDS,
  CURATED_CONNECTION_HINTS,
  curatedKnownConnections,
  isCuratedServiceId,
  loadCuratedService,
  loadCuratedServices,
  listCuratedServiceIds,
} from "@relay/services";
export type { CuratedServiceId } from "@relay/services";
export { runSpec } from "./run.js";
export { resumeSpec } from "./resume.js";
export { replaySpecRun } from "./replay.js";
export {
  MemoryRunStateStore,
  FileRunStateStore,
  createMemoryRunStateStore,
  createFileRunStateStore,
  listRuns,
  listRunSummaries,
} from "./run-state-store.js";
export {
  SPEC_RUN_CHECKPOINT_VERSION,
  newRunId,
  cloneContext,
  toRunSummary,
  filterCheckpoints,
  checkpointCreatedAt,
  checkpointUpdatedAt,
} from "./checkpoint.js";
export { buildRunRecord, statusFromRuntimeState } from "./run-record.js";
export type {
  SpecRunCheckpoint,
  SpecRunStatus,
  SpecRunSummary,
  ListRunsQuery,
  RunStateStore,
} from "./checkpoint.js";
export type { BuildSpecEnginesOptions } from "./engines.js";
export type { ResolvedHostMode } from "./modes.js";
export type { ReplaySpecOptions } from "./replay.js";
export type {
  RunSpecOptions,
  RunSpecResult,
  ResumeSpecOptions,
  SelectServicesResult,
  SpecHostHitlOptions,
  SpecHostHitlRespond,
  SpecHostMode,
} from "./types.js";
export {
  MemoryConnectionStore,
  createMemoryConnectionStore,
  FileJsonConnectionStore,
  createFileJsonConnectionStore,
  EnvConnectionStore,
  createEnvConnectionStore,
  KeychainConnectionStore,
  createKeychainConnectionStore,
  CompositeConnectionStore,
  createCompositeConnectionStore,
  assertConnectionsAvailable,
  collectSpecConnectionRefs,
  connectionResolverFromStore,
  resolveSecretRef,
} from "./connections/index.js";
export type {
  ConnectionCredentials,
  ConnectionFileDocument,
  ConnectionFileEntry,
  ConnectionResolver,
  ConnectionStore,
  EnvConnectionMapEntry,
  EnvConnectionStoreOptions,
  KeychainConnectionStoreOptions,
} from "./connections/index.js";
