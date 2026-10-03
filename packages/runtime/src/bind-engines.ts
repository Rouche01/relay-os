import type {
  AgenticAppManifest,
  EngineType,
  ExecutionEngine,
  StageDefinition,
} from "@relay/protocol";

export type BoundEngineType = Exclude<EngineType, "none">;

/** Eager instance or lazy factory. */
export type EngineProvider = ExecutionEngine | (() => ExecutionEngine);

export type EngineProviders = Partial<Record<BoundEngineType, EngineProvider>>;

/**
 * Resolve manifest `engines_required` (+ optional) against host providers.
 * Also walks nested `stage.fanout.manifest` engines so a parent that nests
 * a child must bind engines for both.
 * Throws if a required engine is missing or a stage references an unbound engine.
 */
export function bindEngines(
  manifest: AgenticAppManifest,
  providers: EngineProviders
): Record<string, ExecutionEngine> {
  const engines: Record<string, ExecutionEngine> = {};
  const required = collectEngineTypes(manifest, "required");
  const optional = collectEngineTypes(manifest, "optional");

  for (const type of required) {
    const provider = providers[type];
    if (!provider) {
      throw new Error(
        `Manifest "${manifest.name}" requires engine "${type}" but no provider was bound`
      );
    }
    engines[type] = resolveProvider(provider, type);
  }

  for (const type of optional) {
    if (engines[type]) continue;
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
  for (const type of collectEngineTypes(manifest, "required")) {
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

/** Walk parent + nested fanout manifests for engines_required / optional. */
function collectEngineTypes(
  manifest: AgenticAppManifest,
  kind: "required" | "optional"
): BoundEngineType[] {
  const seen = new Set<BoundEngineType>();
  const walk = (m: AgenticAppManifest) => {
    const list =
      kind === "required" ? m.engines_required : (m.engines_optional ?? []);
    for (const type of list) {
      if (type !== "none") seen.add(type);
    }
    for (const stage of m.stages) {
      if (stage.fanout?.manifest) {
        walk(stage.fanout.manifest);
      }
    }
  };
  walk(manifest);
  return [...seen];
}

function assertStagesBound(
  manifest: AgenticAppManifest,
  engines: Record<string, ExecutionEngine>,
  seen: Set<string> = new Set()
): void {
  // Guard against accidental cyclic nesting.
  if (seen.has(manifest.name)) return;
  seen.add(manifest.name);

  for (const stage of manifest.stages) {
    assertStageEngine(stage, engines, manifest.name);
    if (stage.fanout?.manifest) {
      if (stage.fanout.manifest.stages.some((s) => s.fanout)) {
        throw new Error(
          `Nested manifest "${stage.fanout.manifest.name}" declares fanout — recursive fanout is not supported in v1`
        );
      }
      assertEnginesForManifest(stage.fanout.manifest, engines);
      assertStagesBound(stage.fanout.manifest, engines, seen);
    }
  }
}

function assertStageEngine(
  stage: StageDefinition,
  engines: Record<string, ExecutionEngine>,
  manifestName: string
): void {
  if (stage.engine === "none") return;
  if (!engines[stage.engine]) {
    throw new Error(
      `Stage "${stage.name}" (manifest "${manifestName}") requires engine "${stage.engine}" which was not bound`
    );
  }
}
