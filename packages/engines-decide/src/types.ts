import type {
  DecisionAnswer,
  DecisionRequest,
  DecisionRoute,
} from "@relay/protocol";

/**
 * Pluggable System-1 backend (Jev HTTP or offline heuristic).
 * Not an ExecutionEngine — apps inject a DecisionPort beside browser/llm.
 */
export interface DecisionBackend {
  readonly name: string;
  decide(request: DecisionRequest): Promise<DecisionAnswer>;
}

export interface DecideAndRouteResult {
  answer: DecisionAnswer;
  route: DecisionRoute;
}

/**
 * App-facing decide co-processor.
 * `decide` returns the typed answer; apps call `routeDecision` / `decideAndRoute`
 * for act | escalate | abort.
 */
export interface DecisionPort {
  readonly backendName: string;
  decide(request: DecisionRequest): Promise<DecisionAnswer>;
  decideAndRoute(request: DecisionRequest): Promise<DecideAndRouteResult>;
}
