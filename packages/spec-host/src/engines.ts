import {
  createApiEngine,
  type ApiFixture,
  type ConnectionResolver,
} from "@relay/engines-api";
import { createDataEngine } from "@relay/engines-data";
import { createLlmEngine } from "@relay/engines-llm";
import type { LlmClient } from "@relay/llm";
import type { ExecutionEngine, ServiceDescriptor } from "@relay/protocol";
import { SpecHostError } from "./errors.js";
import type { SpecHostMode } from "./types.js";

export type BuildSpecEnginesOptions = {
  services: readonly ServiceDescriptor[];
  llmClient: LlmClient;
  resolveConnection?: ConnectionResolver;
  apiFixtures?: readonly ApiFixture[];
  dryRun: boolean;
  blockNetwork: boolean;
  fetch?: typeof fetch;
  extraEngines?: Record<string, ExecutionEngine>;
};

/** Resolve dryRun / blockNetwork defaults from mode + Spec budget. */
export function resolveHostDefaults(options: {
  mode?: SpecHostMode;
  dryRun?: boolean;
  blockNetwork?: boolean;
  budgetDryRun?: boolean;
}): { dryRun: boolean; blockNetwork: boolean; mode: SpecHostMode } {
  const mode = options.mode ?? "fixture";
  const dryRun =
    options.dryRun ??
    options.budgetDryRun ??
    (mode === "live" ? false : true);
  const blockNetwork =
    options.blockNetwork ?? (mode === "fixture" ? true : false);
  return { dryRun, blockNetwork, mode };
}

/**
 * Build api / llm / data engines from Spec-selected services + caller wiring.
 * Optional browser/computer (or other) engines come via `extraEngines`.
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
  const data = createDataEngine();
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

  return engines;
}
