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
export { runSpec } from "./run.js";
export type { BuildSpecEnginesOptions } from "./engines.js";
export type { ResolvedHostMode } from "./modes.js";
export type {
  RunSpecOptions,
  RunSpecResult,
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
