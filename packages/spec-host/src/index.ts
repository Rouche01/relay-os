export { SpecHostError, isSpecHostError } from "./errors.js";
export { buildSpecEngines, resolveHostDefaults } from "./engines.js";
export { selectServicesForSpec } from "./services.js";
export { runSpec } from "./run.js";
export type {
  BuildSpecEnginesOptions,
} from "./engines.js";
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

