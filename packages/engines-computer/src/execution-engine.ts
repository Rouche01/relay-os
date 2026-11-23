import {
  ComputerEngine,
  type ComputerEngineAction,
  type ComputerResult,
} from "@useapron/client";
import type {
  EngineAction,
  EngineResult,
  ExecutionEngine,
} from "@relay/protocol";

/** Map protocol-free client results onto `@relay/protocol` EngineResult. */
export function toEngineResult(result: ComputerResult): EngineResult {
  const out: EngineResult = { success: result.success };
  if (result.data !== undefined) out.data = result.data;
  if (result.error !== undefined) out.error = result.error;
  return out;
}

/**
 * Adapt `@useapron/client` ComputerEngine for sites that require ExecutionEngine.
 * Prefer passing ComputerEngine directly when callers need lease helpers
 * (`getSessionId`, etc.) — it is structurally compatible under method bivariance.
 */
export function toExecutionEngine(client: ComputerEngine): ExecutionEngine {
  return {
    type: "computer",
    healthCheck: () => client.healthCheck(),
    teardown: () => client.teardown(),
    async execute(action: EngineAction): Promise<EngineResult> {
      return toEngineResult(
        await client.execute(action as ComputerEngineAction)
      );
    },
  };
}
