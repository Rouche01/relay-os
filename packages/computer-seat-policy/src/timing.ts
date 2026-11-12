import type { SeatTimingConfig } from "./types.js";

export function defaultSeatTiming(
  overrides: Partial<SeatTimingConfig> = {}
): SeatTimingConfig {
  return {
    actionRateLambda: 0.4, // mean ~2.5s
    exitRateMu: 0.05,
    minMs: 400,
    maxMs: 12_000,
    distribution: "exponential",
    lognormalSigma: 0.6,
    ...overrides,
  };
}

function clamp(ms: number, minMs: number, maxMs: number): number {
  if (!Number.isFinite(ms)) return minMs;
  return Math.min(maxMs, Math.max(minMs, Math.round(ms)));
}

/**
 * Sample inter-action wait in milliseconds.
 * Exponential: T ~ Exp(λ) with mean 1000/λ ms when λ is in 1/seconds.
 * Lognormal: chosen so E[T] ≈ 1000/λ ms.
 */
export function sampleWaitMs(
  config: SeatTimingConfig,
  random: () => number = Math.random
): number {
  const { actionRateLambda: lambda, minMs, maxMs } = config;
  if (!(lambda > 0)) {
    throw new Error("SeatTimingConfig.actionRateLambda must be > 0");
  }
  if (!(minMs >= 0) || !(maxMs >= minMs)) {
    throw new Error("SeatTimingConfig requires 0 <= minMs <= maxMs");
  }

  const u = Math.min(0.999999, Math.max(Number.EPSILON, random()));
  const meanMs = 1000 / lambda;
  const distribution = config.distribution ?? "exponential";

  let raw: number;
  if (distribution === "lognormal") {
    const sigma = config.lognormalSigma ?? 0.6;
    // E[e^{μ+σZ}] = e^{μ+σ²/2} = meanMs  =>  μ = ln(meanMs) - σ²/2
    const mu = Math.log(meanMs) - (sigma * sigma) / 2;
    // Box-Muller
    const u2 = Math.min(0.999999, Math.max(Number.EPSILON, random()));
    const z =
      Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * u2);
    raw = Math.exp(mu + sigma * z);
  } else {
    // Inverse CDF of Exp(λ) in seconds, then ms
    raw = (-Math.log(1 - u) / lambda) * 1000;
  }

  return clamp(raw, minMs, maxMs);
}

/** Independent exit hazard after a step. */
export function shouldExit(
  exitRateMu: number,
  random: () => number = Math.random
): boolean {
  if (!(exitRateMu >= 0) || exitRateMu > 1) {
    throw new Error("SeatTimingConfig.exitRateMu must be in [0, 1]");
  }
  if (exitRateMu === 0) return false;
  return random() < exitRateMu;
}
