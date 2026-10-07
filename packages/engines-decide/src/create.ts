import { routeDecision } from "@relay/protocol";
import { HeuristicDecisionBackend } from "./backends/heuristic.js";
import { JevDecisionBackend } from "./backends/jev.js";
import type { DecisionBackend, DecisionPort } from "./types.js";

export type DecideBackendName = "jev" | "heuristic";

export interface CreateDecisionPortOptions {
  /** Override DECIDE_BACKEND. */
  backend?: DecideBackendName;
  /** Injected backend (tests). When set, ignores env backend name. */
  decisionBackend?: DecisionBackend;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

/**
 * Build a DecisionPort from env or explicit options.
 *
 * - `DECIDE_BACKEND=heuristic` (default) — offline / CI safe
 * - `DECIDE_BACKEND=jev` — requires `JEV_API_KEY`
 */
export function createDecisionPort(
  options: CreateDecisionPortOptions = {}
): DecisionPort {
  const backend =
    options.decisionBackend ?? createBackendFromEnv(options);
  return wrapBackend(backend);
}

export function wrapBackend(backend: DecisionBackend): DecisionPort {
  return {
    backendName: backend.name,
    decide: (request) => backend.decide(request),
    async decideAndRoute(request) {
      const answer = await backend.decide(request);
      return {
        answer,
        route: routeDecision(answer, request.policy),
      };
    },
  };
}

function createBackendFromEnv(
  options: CreateDecisionPortOptions
): DecisionBackend {
  const name = (
    options.backend ??
    process.env.DECIDE_BACKEND ??
    "heuristic"
  )
    .trim()
    .toLowerCase();

  if (name === "jev") {
    return new JevDecisionBackend({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: options.model,
    });
  }

  if (name === "heuristic" || name === "off" || name === "none") {
    return new HeuristicDecisionBackend();
  }

  throw new Error(
    `Unknown DECIDE_BACKEND="${name}" (expected jev|heuristic)`
  );
}
