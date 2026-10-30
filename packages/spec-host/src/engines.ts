import {
  createApiEngine,
  type ApiFixture,
  type ConnectionResolver,
} from "@relay/engines-api";
import {
  createDataEngine,
  type DataStore,
} from "@relay/engines-data";
import { createLlmEngine } from "@relay/engines-llm";
import type { LlmClient } from "@relay/llm";
import type { ExecutionEngine, ServiceDescriptor } from "@relay/protocol";
import { SpecHostError } from "./errors.js";
import {
  createFixtureBrowserEngine,
  createFixtureComputerEngine,
} from "./fallback-engines.js";

export type BuildSpecEnginesOptions = {
  services: readonly ServiceDescriptor[];
  llmClient: LlmClient;
  resolveConnection?: ConnectionResolver;
  apiFixtures?: readonly ApiFixture[];
  dryRun: boolean;
  blockNetwork: boolean;
  fetch?: typeof fetch;
  extraEngines?: Record<string, ExecutionEngine>;
  /**
   * Install fixture browser + computer engines when not provided in extraEngines.
   * Default true — Specs using browser.* / computer.* run offline; override with
   * real Playwright / ComputerEngine via extraEngines for shadow/live.
   */
  fallbackEngines?: boolean;
  /**
   * Durable data store for `data.*` and Spec v2.1 `once` keys.
   * Default: in-memory (run-local). Pass FileJsonDataStore for across-run
   * idempotency under schedule/poll.
   */
  dataStore?: DataStore;
};

/**
 * Build api / llm / data (+ optional browser / computer) engines for Spec runs.
 * browser/computer default to offline fixtures; pass live engines via extraEngines.
 */
export function buildSpecEngines(
  options: BuildSpecEnginesOptions
): Record<string, ExecutionEngine> {
  const resolveConnection: ConnectionResolver =
    options.resolveConnection ??
    (async (connectionId) => {
      throw new SpecHostError(
        "missing_connection_resolver",
        `No resolveConnection provided; cannot resolve ${JSON.stringify(connectionId)}`
      );
    });

  const fetchImpl: typeof fetch = options.blockNetwork
    ? (async () => {
        throw new SpecHostError(
          "network_blocked",
          "spec-host: network blocked (fixture / blockNetwork)"
        );
      }) as typeof fetch
    : options.fetch ?? fetch;

  const llm = createLlmEngine({ client: options.llmClient });
  const data = createDataEngine(
    options.dataStore ? { store: options.dataStore } : undefined
  );
  const engines: Record<string, ExecutionEngine> = {
    llm,
    data,
    ...(options.extraEngines ?? {}),
  };

  // ApiEngine requires ≥1 descriptor — omit when Spec has no services.
  if (options.services.length > 0) {
    engines.api = createApiEngine({
      services: options.services,
      dryRun: options.dryRun,
      fixtures: options.apiFixtures,
      resolveConnection,
      fetch: fetchImpl,
    });
  }

  const useFallback = options.fallbackEngines !== false;
  if (useFallback) {
    if (!engines.browser) {
      engines.browser = createFixtureBrowserEngine({ dryRun: options.dryRun });
    }
    if (!engines.computer) {
      engines.computer = createFixtureComputerEngine({ dryRun: options.dryRun });
    }
  }

  return engines;
}

/** @deprecated Import from `./modes.js` — kept for older callers. */
export { resolveHostDefaults } from "./modes.js";
