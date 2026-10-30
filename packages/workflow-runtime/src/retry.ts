/**
 * Spec v2.1 retry helpers — attempt budgeting + backoff sleep.
 */

import type { SpecV2OnError, SpecV2Retry } from "@relay/protocol";

export function resolveAttemptBudget(retry?: SpecV2Retry): number {
  if (!retry) return 1;
  const max = retry.max;
  if (typeof max !== "number" || !Number.isInteger(max) || max < 1) return 1;
  return max;
}

export function resolveOnError(onError?: SpecV2OnError): SpecV2OnError {
  return onError ?? "fail";
}

export function backoffMsForAttempt(
  retry: SpecV2Retry | undefined,
  attemptIndex: number
): number {
  if (!retry || attemptIndex <= 0) return 0;
  const base = retry.backoffMs ?? 0;
  if (!(base > 0)) return 0;
  return base;
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
