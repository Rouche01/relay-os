import {
  DEFAULT_MIN_CONFIDENCE,
  routeDecision,
  type DecisionAnswer,
  type DecisionPolicy,
  type DecisionRequest,
  type DecisionRoute,
} from "@relay/protocol";

export {
  DEFAULT_MIN_CONFIDENCE,
  policyRequiresEscalate,
  routeDecision,
} from "@relay/protocol";

/** Env floor for discover-fit Noul (calibrate from traces; start conservative). */
export function discoverMinConfidence(
  fallback = DEFAULT_MIN_CONFIDENCE
): number {
  return readConfidenceEnv("DECIDE_DISCOVER_MIN_CONFIDENCE", fallback);
}

/** Optional interstitial page-class floor; falls back to default. */
export function interstitialMinConfidence(
  fallback = DEFAULT_MIN_CONFIDENCE
): number {
  return readConfidenceEnv("DECIDE_INTERSTITIAL_MIN_CONFIDENCE", fallback);
}

/** Floor for login control Choice (open / username / password / submit). */
export function loginMinConfidence(
  fallback = DEFAULT_MIN_CONFIDENCE
): number {
  return readConfidenceEnv("DECIDE_LOGIN_MIN_CONFIDENCE", fallback);
}

export function withMinConfidence(
  policy: DecisionPolicy | undefined,
  minConfidence: number
): DecisionPolicy {
  return { ...(policy ?? {}), minConfidence };
}

export function routeRequest(
  request: DecisionRequest,
  answer: DecisionAnswer
): DecisionRoute {
  return routeDecision(answer, request.policy);
}

function readConfidenceEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  if (n > 1 && n <= 100) return n / 100;
  if (n < 0 || n > 1) return fallback;
  return n;
}
