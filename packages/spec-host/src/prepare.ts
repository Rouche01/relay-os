import type { ConnectionResolver } from "@relay/engines-api";
import type { LlmClient } from "@relay/llm";
import {
  createDraftSpecV2,
  freezeSpecV2,
  type SpecV2,
  type SpecV2Body,
  type ServiceDescriptor,
} from "@relay/protocol";
import { assertEvalsGate, runEvals, type EvalReport } from "@relay/spec-evals";
import { lowerSpecV2, type LoweredWorkflow } from "@relay/spec-lower";
import { validateSpecV2 } from "@relay/spec-validator";
import {
  assertConnectionsAvailable,
  connectionResolverFromStore,
} from "./connections/resolver.js";
import type { ConnectionStore } from "./connections/types.js";
import { SpecHostError } from "./errors.js";
import { buildSpecEngines } from "./engines.js";
import { resolveRunLlmClient } from "./llm-client.js";
import {
  assertModeAllowed,
  resolveHostDefaults,
  type ResolvedHostMode,
} from "./modes.js";
import { selectServicesForSpec } from "./services.js";
import type { SpecHostMode } from "./types.js";
import type { ExecutionEngine } from "@relay/protocol";
import type { ApiFixture } from "@relay/engines-api";
import type { EvalCase } from "@relay/spec-evals";

export type PreparedSpecRun = {
  body: SpecV2Body;
  frozen: SpecV2;
  lowered: LoweredWorkflow;
  selectedServices: ServiceDescriptor[];
  resolveConnection?: ConnectionResolver;
  knownConnections?: readonly string[];
  llmClient: LlmClient;
  engines: Record<string, ExecutionEngine>;
  mode: SpecHostMode;
  dryRun: boolean;
  blockNetwork: boolean;
  evalReport?: EvalReport;
};

export function bodyFromFrozenOrBody(options: {
  body?: SpecV2Body;
  frozen?: SpecV2;
}): SpecV2Body {
  if (options.frozen) {
    const {
      id: _id,
      version: _version,
      status: _status,
      intentId: _intentId,
      createdAt: _createdAt,
      frozenAt: _frozenAt,
      frozenBy: _frozenBy,
      contentHash: _contentHash,
      procedure: _procedure,
      ...body
    } = options.frozen;
    return body;
  }
  if (options.body) return options.body;
  throw new SpecHostError(
    "missing_spec",
    "runSpec requires body or frozen Spec"
  );
}

export async function prepareSpecRun(options: {
  body?: SpecV2Body;
  frozen?: SpecV2;
  services: readonly ServiceDescriptor[];
  connectionStore?: ConnectionStore;
  knownConnections?: readonly string[];
  resolveConnection?: ConnectionResolver;
  llmClient?: LlmClient;
  apiFixtures?: readonly ApiFixture[];
  dryRun?: boolean;
  blockNetwork?: boolean;
  fetch?: typeof fetch;
  mode?: SpecHostMode;
  extraEngines?: Record<string, ExecutionEngine>;
  evals?: { cases: readonly EvalCase[]; softFailClosed?: boolean };
  skipValidate?: boolean;
  draftId?: string;
  intentId?: string;
  frozenBy?: string;
  name?: string;
}): Promise<PreparedSpecRun> {
  const body = bodyFromFrozenOrBody(options);
  const selected = selectServicesForSpec(body, options.services);
  if (!selected.ok) {
    throw new SpecHostError(
      "missing_services",
      `Spec references unknown services: ${selected.missing.join(", ")}`,
      { missing: selected.missing }
    );
  }

  let knownConnections = options.knownConnections;
  let resolveConnection = options.resolveConnection;

  if (options.connectionStore) {
    const fromStore = await assertConnectionsAvailable(
      body,
      options.connectionStore
    );
    if (!knownConnections) knownConnections = fromStore;
    if (!resolveConnection) {
      resolveConnection = connectionResolverFromStore(options.connectionStore);
    }
  }

  if (!options.skipValidate) {
    const validation = validateSpecV2(body, {
      services: options.services,
      knownConnections,
    });
    if (!validation.ok) {
      throw new SpecHostError(
        "invalid_spec",
        `Spec validation failed (${validation.errors.length} error(s))`,
        { validation }
      );
    }
  }

  const frozen: SpecV2 =
    options.frozen ??
    freezeSpecV2(
      createDraftSpecV2({
        ...body,
        id: options.draftId,
        intentId: options.intentId,
      }),
      { frozenBy: options.frozenBy ?? "spec-host" }
    );

  const lowered = lowerSpecV2(frozen, {
    name: options.name ?? "spec-host-run",
    specId: frozen.id,
    specRecord: {
      id: frozen.id,
      version: frozen.version,
      status: frozen.status,
      intentId: frozen.intentId,
    },
  });

  const resolved: ResolvedHostMode = resolveHostDefaults({
    mode: options.mode,
    dryRun: options.dryRun,
    blockNetwork: options.blockNetwork,
    budgetDryRun: body.budget?.dryRun,
  });
  assertModeAllowed(resolved.mode, body, resolved);

  if (
    resolved.mode !== "fixture" &&
    !options.connectionStore &&
    !resolveConnection
  ) {
    throw new SpecHostError(
      "missing_connection_resolver",
      `${resolved.mode} mode requires connectionStore (or resolveConnection) for live API auth`
    );
  }

  const llmClient = resolveRunLlmClient({
    mode: resolved.mode,
    llmClient: options.llmClient,
  });

  const engines = buildSpecEngines({
    services: selected.services,
    llmClient,
    resolveConnection,
    apiFixtures: options.apiFixtures,
    dryRun: resolved.dryRun,
    blockNetwork: resolved.blockNetwork,
    fetch: options.fetch,
    extraEngines: options.extraEngines,
  });

  let evalReport: EvalReport | undefined;
  if (options.evals?.cases.length) {
    evalReport = await runEvals({
      lowered,
      softFailClosed: options.evals.softFailClosed ?? false,
      llmEngine: engines.llm,
      fixtures: { cases: [...options.evals.cases] },
    });
    try {
      assertEvalsGate(evalReport);
    } catch (err) {
      throw new SpecHostError(
        "evals_gate",
        err instanceof Error ? err.message : String(err),
        { evalReport }
      );
    }
  }

  return {
    body,
    frozen,
    lowered,
    selectedServices: selected.services,
    resolveConnection,
    knownConnections,
    llmClient,
    engines,
    mode: resolved.mode,
    dryRun: resolved.dryRun,
    blockNetwork: resolved.blockNetwork,
    evalReport,
  };
}
