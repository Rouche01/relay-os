import type {
  AgenticAppManifest,
  EngineType,
  ExecutionEngine,
} from "@relay/protocol";

export type BoundEngineType = Exclude<EngineType, "none">;

/** Eager instance or lazy factory. */
export type EngineProvider = ExecutionEngine | (() => ExecutionEngine);

export type EngineProviders = Partial<Record<BoundEngineType, EngineProvider>>;

/**
 * Resolve manifest `engines_required` (+ optional) against host providers.
 * Throws if a required engine is missing or a stage references an unbound engine.
 */
export function bindEngines(
  manifest: AgenticAppManifest,
  providers: EngineProviders
): Record<string, ExecutionEngine> {
  const engines: Record<string, ExecutionEngine> = {};

  for (const type of manifest.engines_required) {
    if (type === "none") continue;
    const provider = providers[type];
    if (!provider) {
      throw new Error(
        `Manifest "${manifest.name}" requires engine "${type}" but no provider was bound`
      );
    }
    const engine = resolveProvider(provider, type);
    engines[type] = engine;
  }

  for (const type of manifest.engines_optional ?? []) {
    if (type === "none" || engines[type]) continue;
    const provider = providers[type];
    if (!provider) continue;
    engines[type] = resolveProvider(provider, type);
  }

  assertStagesBound(manifest, engines);
  return engines;
}

/** Validate an already-built engines map against the manifest (e.g. tests). */
export function assertEnginesForManifest(
  manifest: AgenticAppManifest,
  engines: Record<string, ExecutionEngine>
): void {
  for (const type of manifest.engines_required) {
    if (type === "none") continue;
    if (!engines[type]) {
      throw new Error(
        `Manifest "${manifest.name}" requires engine "${type}" but it is missing from the engines map`
      );
    }
    if (engines[type]!.type !== type) {
      throw new Error(
        `Engine map key "${type}" has type "${engines[type]!.type}"`
      );
    }
  }
  assertStagesBound(manifest, engines);
}

function resolveProvider(
  provider: EngineProvider,
  expected: BoundEngineType
): ExecutionEngine {
  const engine = typeof provider === "function" ? provider() : provider;
  if (engine.type !== expected) {
    throw new Error(
      `Provider for "${expected}" returned engine type "${engine.type}"`
    );
  }
  return engine;
}

function assertStagesBound(
  manifest: AgenticAppManifest,
  engines: Record<string, ExecutionEngine>
): void {
  for (const stage of manifest.stages) {
    if (stage.engine === "none") continue;
    if (!engines[stage.engine]) {
      throw new Error(
        `Stage "${stage.name}" requires engine "${stage.engine}" which was not bound`
      );
    }
  }
}
